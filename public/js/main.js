// 智能阅读助手主逻辑
document.addEventListener('DOMContentLoaded', () => {
    // DOM元素
    const userInput = document.getElementById('user-input');
    const submitBtn = document.getElementById('submit-btn');
    const resultsContainer = document.getElementById('results-container');
    const infoBox = document.getElementById('info-box');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyBtn = document.getElementById('save-api-key');
    const clearApiKeyBtn = document.getElementById('clear-api-key');
    const loadingIndicator = document.getElementById('loading-indicator');

    // 初始化：检查保存的API Key
    const savedApiKey = localStorage.getItem('geminiApiKey');
    if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
        infoBox.textContent = '已加载保存的API Key';
        infoBox.style.display = 'block';
    }

    // 保存API Key到本地存储
    saveApiKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem('geminiApiKey', key);
            infoBox.textContent = 'API Key已保存';
            infoBox.style.display = 'block';
        } else {
            infoBox.textContent = '请输入有效的API Key';
            infoBox.style.display = 'block';
        }
    });

    // 清除保存的API Key
    clearApiKeyBtn.addEventListener('click', () => {
        localStorage.removeItem('geminiApiKey');
        apiKeyInput.value = '';
        infoBox.textContent = 'API Key已清除';
        infoBox.style.display = 'block';
    });

    // 提交查询
    submitBtn.addEventListener('click', handleSubmit);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSubmit();
    });

    // 点击镜像链接下拉按钮
    resultsContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-btn')) {
            const targetId = e.target.getAttribute('data-target');
            const dropdown = document.getElementById(targetId);
            if (dropdown) {
                dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            }
        }

        // 处理镜像链接点击反馈
        if (e.target.classList.contains('mirror-link')) {
            const mirrorUrl = e.target.getAttribute('href');
            const mirrorText = e.target.textContent;
            
            // 5秒后询问用户是否成功访问
            setTimeout(() => {
                if (!window.confirm(`是否成功访问 "${mirrorText}"？\n若未成功，建议尝试其他镜像。`)) {
                    e.target.classList.add('unreachable');
                    e.target.title = '该镜像可能无法访问';
                }
            }, 5000);
        }
    });

    // 处理查询提交
    async function handleSubmit() {
        const query = userInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        if (!query) {
            infoBox.textContent = '请输入你的阅读需求';
            infoBox.style.display = 'block';
            return;
        }

        if (!apiKey) {
            infoBox.textContent = '请输入并保存你的Gemini API Key';
            infoBox.style.display = 'block';
            return;
        }

        // 显示加载状态
        loadingIndicator.style.display = 'block';
        resultsContainer.innerHTML = '';
        infoBox.style.display = 'none';

        try {
            // 构建提示并调用AI
            const prompt = buildUltimatePrompt(query);
            const response = await fetch('/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey, body: prompt })
            });

            if (!response.ok) {
                throw new Error(`API请求失败: ${response.statusText}`);
            }

            const result = await response.json();
            displayResults(result);
        } catch (error) {
            console.error('处理请求时出错:', error);
            displayError(`处理请求时出错: ${error.message}`);
        } finally {
            loadingIndicator.style.display = 'none';
        }
    }

    // 构建AI提示 - 强化镜像安全与时效性
    function buildUltimatePrompt(userQuery) {
        const instruction = `
你是一个严谨的图书资源安全专家，必须严格遵守以下规则生成JSON报告：

**CRITICAL SAFETY RULES (最高优先级):**
1. 绝对禁止提供任何涉及色情、恶意软件、赌博或非图书内容的网站，包括曾被用于此类目的的域名。
2. 镜像安全性验证标准：
   - 必须来自近30天内社区确认可用的列表（如r/AnnaArchivist、Z-Library官方论坛）；
   - 域名历史无不良记录（通过WHOIS或信誉平台验证）；
   - 必须支持HTTPS加密连接；
   - 排除任何被主流安全软件标记为危险的域名。

**最终JSON报告结构（必须严格遵守）：**
{
  "reading_plan": {
    "planTitle": "根据用户需求生成的阅读计划标题",
    "description": "对阅读计划的简要说明",
    "books": [
      {
        "title": "书籍标题",
        "author": "作者名",
        "description": "书籍简介",
        "reason": "推荐理由"
      }
    ]
  },
  "resource_access": {
    "anna_archive": [
      {
        "url": "https://...", // 镜像完整URL
        "domain": "example.com", // 提取域名
        "last_verified": "2024-06-01", // 最近验证日期（近30天内）
        "source": "社区推荐" // 验证来源（如"官方公告"、"用户反馈"）
      }
    ],
    "z_library": [ // 同上结构
      { "url": "...", "domain": "...", "last_verified": "...", "source": "..." }
    ]
  }
}

**执行指令:**
1. 阅读计划保持3-5本书，结构不变；
2. 镜像必须是近30天内可访问的最新地址，每个平台至少提供3个有效镜像；
3. 按安全性优先级排序（官方镜像 > 社区高信誉镜像 > 普通镜像）；
4. 若无法确认安全性，直接排除该镜像，不允许猜测；
5. 输出必须是纯JSON，无任何额外文本。
`;
        return {
            contents: [{ 
                role: "user", 
                parts: [
                    { text: instruction }, 
                    { text: "用户的阅读需求：" }, 
                    { text: userQuery }
                ] 
            }],
            generationConfig: { response_mime_type: "application/json" }
        };
    }

    // 镜像安全二次校验
    function validateMirrorSafety(mirror) {
        try {
            const url = new URL(mirror.url);
            // 规则1：必须使用HTTPS
            if (url.protocol !== 'https:') {
                console.warn(`拒绝非HTTPS镜像: ${mirror.url}`);
                return false;
            }
            // 规则2：拦截已知可疑关键词
            const suspiciousKeywords = ['porn', 'sex', 'malware', 'hack', 'crack', 'virus', 'adult'];
            const hasSuspicious = suspiciousKeywords.some(keyword => 
                url.hostname.toLowerCase().includes(keyword)
            );
            if (hasSuspicious) {
                console.warn(`拦截含可疑关键词的镜像: ${mirror.url}`);
                return false;
            }
            // 规则3：验证日期必须在近30天内
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const verifiedDate = new Date(mirror.last_verified);
            if (verifiedDate < thirtyDaysAgo || isNaN(verifiedDate.getTime())) {
                console.warn(`镜像验证过期或无效: ${mirror.url} (验证于 ${mirror.last_verified})`);
                return false;
            }
            return true;
        } catch (error) {
            console.warn(`无效URL格式: ${mirror.url}`);
            return false;
        }
    }

    // 显示结果
    function displayResults(report) {
        resultsContainer.innerHTML = '';
        infoBox.style.display = 'block';
        infoBox.innerHTML = '<p>已生成阅读计划和可用资源链接</p>';
        
        const data = report?.reading_plan;
        const resourceList = report?.resource_access;
        
        if (!data || !data.planTitle || !Array.isArray(data.books) || !resourceList) {
            displayError("AI返回的报告结构不完整，无法解析。");
            return;
        }

        // 过滤安全的镜像
        const annaMirrors = (resourceList.anna_archive || []).filter(validateMirrorSafety);
        const zlibMirrors = (resourceList.z_library || []).filter(validateMirrorSafety);

        // 显示镜像状态提示
        if (annaMirrors.length === 0) {
            infoBox.innerHTML += `<p>⚠️ 未找到安全可用的 Anna's Archive 镜像，请尝试其他平台。</p>`;
        }
        if (zlibMirrors.length === 0) {
            infoBox.innerHTML += `<p>⚠️ 未找到安全可用的 Z-Library 镜像，请尝试其他平台。</p>`;
        }

        // 创建阅读计划标题
        const planTitle = document.createElement('h2');
        planTitle.className = 'plan-title';
        planTitle.textContent = data.planTitle;
        resultsContainer.appendChild(planTitle);

        // 创建计划描述
        const planDesc = document.createElement('p');
        planDesc.className = 'plan-description';
        planDesc.textContent = data.description || '根据你的阅读需求定制的阅读计划';
        resultsContainer.appendChild(planDesc);

        // 创建书籍列表
        const booksGrid = document.createElement('div');
        booksGrid.className = 'books-grid';
        resultsContainer.appendChild(booksGrid);

        // 为每本书创建卡片
        data.books.forEach((book, index) => {
            const bookCard = document.createElement('div');
            bookCard.className = 'book-card';
            
            // 搜索关键词（用于构建搜索链接）
            const searchQuery = encodeURIComponent(`${book.title} ${book.author}`);
            
            // 创建镜像链接下拉菜单
            const annaHtml = createDropdownHTML(
                `anna-archive-${index}`, 
                "Anna's Archive", 
                annaMirrors.length > 0 ? annaMirrors[0].url : '',
                annaMirrors, 
                `/search?q=${searchQuery}`
            );
            
            const zlibHtml = createDropdownHTML(
                `z-library-${index}`, 
                "Z-Library", 
                zlibMirrors.length > 0 ? zlibMirrors[0].url : '',
                zlibMirrors, 
                `/search?q=${searchQuery}`
            );

            bookCard.innerHTML = `
                <h3 class="book-title">${book.title}</h3>
                <p class="book-author">作者: ${book.author || '未知'}</p>
                <p class="book-description">${book.description || '无简介'}</p>
                <p class="book-reason"><strong>推荐理由:</strong> ${book.reason || '无'}</p>
                <div class="resource-links">
                    ${annaHtml}
                    ${zlibHtml}
                </div>
            `;
            
            booksGrid.appendChild(bookCard);
        });
    }

    // 创建镜像下拉菜单HTML
    function createDropdownHTML(id, label, defaultUrl, mirrors, searchPath) {
        if (mirrors.length === 0) {
            return `<div class="links-wrapper">
                <button class="toggle-btn" disabled>${label} (无安全镜像)</button>
            </div>`;
        }

        let dropdownHtml = `<div class="mirror-links-dropdown" id="${id}" style="display:none;">`;
        mirrors.forEach(mirror => {
            // 构建完整搜索URL
            const fullUrl = new URL(mirror.url);
            fullUrl.pathname = searchPath.startsWith('/') ? searchPath : `/${searchPath}`;
            
            // 镜像显示文本
            const displayText = `${mirror.domain} (验证于 ${mirror.last_verified}) - ${mirror.source}`;
            
            dropdownHtml += `<a href="${fullUrl.toString()}" target="_blank" class="mirror-link ${mirror.source.includes('官方') ? 'official-link' : ''}">
                ${displayText}
            </a>`;
        });
        dropdownHtml += `</div>`;

        return `<div class="links-wrapper">
            <button class="toggle-btn" data-target="${id}">${label} (${mirrors.length}个安全镜像)</button>
            ${dropdownHtml}
        </div>`;
    }

    // 显示错误信息
    function displayError(message) {
        infoBox.textContent = message;
        infoBox.style.display = 'block';
        infoBox.style.color = '#dc3545';
    }
});
