// 等待DOM完全加载后执行
document.addEventListener('DOMContentLoaded', function() {
    // 获取关键DOM元素（确保ID与HTML一致）
    const searchBtn = document.getElementById('search-btn');
    const queryInput = document.getElementById('query-input');
    const resultsContainer = document.getElementById('results-container');
    const infoBox = document.getElementById('info-box');
    const loadingSpinner = document.getElementById('loading-spinner');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');

    // 检查元素是否存在（避免因元素缺失导致后续代码中断）
    if (!searchBtn || !queryInput || !resultsContainer) {
        console.error('关键DOM元素缺失，检查HTML中的ID是否正确');
        return;
    }

    // 搜索按钮点击事件（核心修复：确保事件正确绑定）
    searchBtn.addEventListener('click', async function() {
        const userQuery = queryInput.value.trim();
        if (!userQuery) {
            alert('请输入阅读需求后再生成计划');
            return;
        }

        // 显示加载状态
        loadingSpinner.style.display = 'block';
        resultsContainer.innerHTML = '';
        infoBox.style.display = 'none';

        try {
            // 验证API Key是否存在
            const apiKeys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
            if (apiKeys.length === 0) {
                alert('请先在设置中添加Google Gemini API Key');
                loadingSpinner.style.display = 'none';
                return;
            }
            const apiKey = apiKeys[0]; // 使用第一个可用的API Key

            // 构建请求参数（修复Prompt格式，避免JSON解析错误）
            const promptConfig = buildUltimatePrompt(userQuery);
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + apiKey, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(promptConfig)
            });

            if (!response.ok) {
                throw new Error(`API请求失败: ${response.statusText}`);
            }

            const data = await response.json();
            // 解析AI返回的JSON（修复：确保从正确的字段提取内容）
            const aiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!aiResponseText) {
                throw new Error('AI返回格式异常，无法提取内容');
            }

            const report = JSON.parse(aiResponseText); // 解析JSON报告
            displayResults(report); // 展示结果
            infoBox.style.display = 'block';

        } catch (error) {
            // 错误处理（修复：明确提示错误原因）
            console.error('生成失败:', error);
            resultsContainer.innerHTML = `
                <div class="error-message">
                    <p>生成阅读计划时出错：${error.message}</p>
                    <p>请检查API Key是否有效，或稍后再试</p>
                </div>
            `;
        } finally {
            loadingSpinner.style.display = 'none'; // 无论成功失败都隐藏加载
        }
    });

    // 镜像安全二次校验（修复：日期处理兼容格式问题）
    function validateMirrorSafety(mirror) {
        try {
            const url = new URL(mirror.url);
            // 必须使用HTTPS
            if (url.protocol !== 'https:') {
                console.warn(`拒绝非HTTPS镜像: ${mirror.url}`);
                return false;
            }
            // 拦截可疑关键词
            const suspiciousKeywords = ['porn', 'sex', 'malware', 'hack', 'crack'];
            const hasSuspicious = suspiciousKeywords.some(keyword => 
                url.hostname.toLowerCase().includes(keyword)
            );
            if (hasSuspicious) {
                console.warn(`拦截含可疑关键词的镜像: ${mirror.url}`);
                return false;
            }
            // 验证日期在30天内（兼容不同日期格式）
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const verifiedDate = new Date(mirror.last_verified);
            if (isNaN(verifiedDate.getTime()) || verifiedDate < thirtyDaysAgo) {
                console.warn(`镜像验证过期或格式错误: ${mirror.url}`);
                return false;
            }
            return true;
        } catch (error) {
            console.warn(`无效URL: ${mirror.url}，错误: ${error.message}`);
            return false;
        }
    }

    // 构建AI提示词（修复：确保JSON格式严格）
    function buildUltimatePrompt(userQuery) {
        const instruction = `
你是图书资源安全专家，必须返回严格符合以下格式的JSON：
{
  "reading_plan": {
    "planTitle": "计划标题",
    "books": [
      {
        "title": "书名",
        "author": "作者",
        "description": "描述",
        "priority": "优先级"
      }
    ]
  },
  "resource_access": {
    "anna_archive": [
      { "url": "https://...", "domain": "...", "last_verified": "YYYY-MM-DD", "source": "..." }
    ],
    "z_library": [
      { "url": "https://...", "domain": "...", "last_verified": "YYYY-MM-DD", "source": "..." }
    ]
  }
}
要求：1. 镜像必须是近30天内有效的HTTPS地址；2. 排除色情/恶意网站；3. 每个平台至少3个镜像。
用户需求：${userQuery}
输出必须是纯JSON，无额外文本！
        `.trim();

        return {
            contents: [{ role: "user", parts: [{ text: instruction }] }],
            generationConfig: { response_mime_type: "application/json" }
        };
    }

    // 展示结果（修复：下拉菜单点击事件）
    function displayResults(report) {
        resultsContainer.innerHTML = '';
        const books = report?.reading_plan?.books || [];
        const resources = report?.resource_access || {};

        if (books.length === 0) {
            resultsContainer.innerHTML = '<p>未生成书籍计划，请检查输入后重试</p>';
            return;
        }

        // 过滤安全镜像
        const annaMirrors = (resources.anna_archive || []).filter(validateMirrorSafety);
        const zlibMirrors = (resources.z_library || []).filter(validateMirrorSafety);

        books.forEach((book, index) => {
            const bookCard = document.createElement('div');
            bookCard.className = 'result-card';
            bookCard.innerHTML = `
                <h3 class="book-title">${index + 1}. ${book.title}</h3>
                <p><strong>作者：</strong>${book.author || '未知'}</p>
                <p><strong>推荐理由：</strong>${book.description || '无'}</p>
                <div class="links-container">
                    ${createDropdownHTML(`anna-${index}`, "Anna's Archive", annaMirrors)}
                    ${createDropdownHTML(`zlib-${index}`, "Z-Library", zlibMirrors)}
                </div>
            `;
            resultsContainer.appendChild(bookCard);
        });

        // 绑定下拉菜单切换事件（修复：动态元素事件委托）
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const targetId = this.getAttribute('data-target');
                const dropdown = document.getElementById(targetId);
                if (dropdown) {
                    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
                }
            });
        });
    }

    // 创建下拉菜单HTML（修复：确保链接可点击）
    function createDropdownHTML(id, label, mirrors) {
        if (mirrors.length === 0) {
            return `<div class="links-wrapper">
                <button class="toggle-btn" disabled>${label} (无安全镜像)</button>
            </div>`;
        }

        let dropdownHtml = `<div id="${id}" class="mirror-links-dropdown" style="display:none;">`;
        mirrors.forEach(mirror => {
            dropdownHtml += `<a href="${mirror.url}" target="_blank" class="mirror-link">
                ${mirror.domain}（验证于${mirror.last_verified}）
            </a>`;
        });
        dropdownHtml += `</div>`;

        return `<div class="links-wrapper">
            <button class="toggle-btn" data-target="${id}">${label}（${mirrors.length}个镜像）</button>
            ${dropdownHtml}
        </div>`;
    }

    // 设置弹窗相关逻辑（修复：确保弹窗正常开关）
    settingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
    });
    closeModalBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.style.display = 'none'; // 点击外部关闭
        }
    });

    // API Key管理（修复：本地存储操作）
    const apiKeyInput = document.getElementById('api-key-input');
    const addKeyBtn = document.getElementById('add-key-btn');
    const keyListUl = document.getElementById('key-list-ul');

    if (apiKeyInput && addKeyBtn && keyListUl) {
        // 加载已保存的API Key
        function loadApiKeys() {
            const keys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
            keyListUl.innerHTML = keys.map((key, i) => `
                <li>
                    <span>${key.substring(0, 8)}...${key.substring(key.length - 4)}</span>
                    <button class="delete-key-btn" data-index="${i}">×</button>
                </li>
            `).join('');
        }

        addKeyBtn.addEventListener('click', () => {
            const key = apiKeyInput.value.trim();
            if (key) {
                const keys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
                keys.push(key);
                localStorage.setItem('geminiApiKeys', JSON.stringify(keys));
                apiKeyInput.value = '';
                loadApiKeys();
            }
        });

        keyListUl.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-key-btn')) {
                const index = e.target.getAttribute('data-index');
                const keys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
                keys.splice(index, 1);
                localStorage.setItem('geminiApiKeys', JSON.stringify(keys));
                loadApiKeys();
            }
        });

        loadApiKeys(); // 初始加载
    }
});
