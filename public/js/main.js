// 智能阅读助手前端主逻辑
document.addEventListener('DOMContentLoaded', () => {
    // DOM元素获取
    const searchBtn = document.getElementById('search-btn');
    const queryInput = document.getElementById('query-input');
    const resultsContainer = document.getElementById('results-container');
    const infoBox = document.getElementById('info-box');
    const loadingSpinner = document.getElementById('loading-spinner');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const apiKeyInput = document.getElementById('api-key-input');
    const addKeyBtn = document.getElementById('add-key-btn');
    const keyListUl = document.getElementById('key-list-ul');

    // 检查关键元素是否存在
    const requiredElements = [searchBtn, queryInput, resultsContainer];
    if (requiredElements.some(el => !el)) {
        console.error('关键DOM元素缺失，请检查HTML中的ID是否正确');
        showInfo('页面加载失败，请刷新重试', 'error');
        return;
    }

    // 初始化API Key列表
    loadApiKeys();

    // 事件绑定
    searchBtn.addEventListener('click', handleSearch);
    queryInput.addEventListener('keypress', e => e.key === 'Enter' && handleSearch());
    settingsBtn.addEventListener('click', () => settingsModal.style.display = 'flex');
    closeModalBtn.addEventListener('click', () => settingsModal.style.display = 'none');
    settingsModal.addEventListener('click', e => e.target === settingsModal && (settingsModal.style.display = 'none'));
    addKeyBtn.addEventListener('click', addApiKey);
    keyListUl.addEventListener('click', handleDeleteKey);

    // 搜索处理函数
    async function handleSearch() {
        const userQuery = queryInput.value.trim();
        if (!userQuery) {
            showInfo('请输入阅读需求', 'warning');
            return;
        }

        // 获取API Key
        const apiKeys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
        if (apiKeys.length === 0) {
            showInfo('请先在设置中添加Gemini API Key', 'warning');
            settingsModal.style.display = 'flex'; // 自动打开设置面板
            return;
        }
        const apiKey = apiKeys[0];

        // 显示加载状态
        loadingSpinner.style.display = 'block';
        resultsContainer.innerHTML = '';
        showInfo('', '');

        try {
            // 构建请求参数
            const promptConfig = buildPrompt(userQuery);
            
            // 调用代理服务（关键修复：通过proxy转发请求）
            const response = await fetch('/proxy', { // 确保路径与proxy.js部署一致
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: apiKey,
                    body: promptConfig,
                    scrapeTask: null
                })
            });

            // 详细错误处理
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                const errorMsg = errorData?.details || `HTTP错误: ${response.status} ${response.statusText}`;
                throw new Error(`API请求失败: ${errorMsg}`);
            }

            // 解析响应
            const data = await response.json();
            const aiResponseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!aiResponseText) {
                throw new Error('AI未返回有效内容');
            }

            // 解析AI生成的计划
            const report = JSON.parse(aiResponseText);
            displayResults(report);
            showInfo('阅读计划生成成功', 'success');

        } catch (error) {
            console.error('搜索失败:', error);
            showInfo(`生成失败: ${error.message}`, 'error');
            resultsContainer.innerHTML = `
                <div class="error-card">
                    <p>错误详情: ${error.message}</p>
                    <p>建议: 检查API Key有效性或稍后重试</p>
                </div>
            `;
        } finally {
            loadingSpinner.style.display = 'none';
        }
    }

    // 构建AI提示词
    function buildPrompt(userQuery) {
        return {
            contents: [{
                role: "user",
                parts: [{
                    text: `请生成符合以下格式的阅读计划JSON（仅返回JSON）：
{
  "reading_plan": {
    "planTitle": "计划标题",
    "books": [
      {
        "title": "书名",
        "author": "作者",
        "description": "简介",
        "priority": "优先级"
      }
    ]
  },
  "resource_access": {
    "anna_archive": [{"url": "https://...", "domain": "...", "last_verified": "YYYY-MM-DD", "source": "..."}],
    "z_library": [{"url": "https://...", "domain": "...", "last_verified": "YYYY-MM-DD", "source": "..."}]
  }
}
用户需求：${userQuery}
要求：镜像必须是近30天内有效的HTTPS地址，排除色情/恶意网站。`
                }]
            }],
            generationConfig: { response_mime_type: "application/json" }
        };
    }

    // 显示结果
    function displayResults(report) {
        const books = report?.reading_plan?.books || [];
        const resources = report?.resource_access || {};

        if (books.length === 0) {
            resultsContainer.innerHTML = '<p class="no-results">未找到相关书籍，请尝试其他关键词</p>';
            return;
        }

        // 过滤安全镜像
        const annaMirrors = (resources.anna_archive || []).filter(validateMirror);
        const zlibMirrors = (resources.z_library || []).filter(validateMirror);

        // 生成书籍卡片
        resultsContainer.innerHTML = books.map((book, index) => `
            <div class="book-card">
                <h3>${index + 1}. ${book.title}</h3>
                <p><strong>作者：</strong>${book.author || '未知'}</p>
                <p><strong>简介：</strong>${book.description || '无'}</p>
                <p><strong>优先级：</strong>${book.priority || '推荐'}</p>
                <div class="mirror-links">
                    ${createMirrorDropdown(`anna-${index}`, "Anna's Archive", annaMirrors)}
                    ${createMirrorDropdown(`zlib-${index}`, "Z-Library", zlibMirrors)}
                </div>
            </div>
        `).join('');

        // 绑定下拉菜单事件
        document.querySelectorAll('.mirror-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = document.getElementById(btn.dataset.target);
                target.style.display = target.style.display === 'block' ? 'none' : 'block';
            });
        });
    }

    // 镜像安全验证
    function validateMirror(mirror) {
        try {
            const url = new URL(mirror.url);
            // 检查HTTPS
            if (url.protocol !== 'https:') return false;
            // 检查可疑关键词
            const badWords = ['porn', 'sex', 'malware', 'hack'];
            if (badWords.some(word => url.hostname.includes(word))) return false;
            // 检查日期有效性
            const verifiedDate = new Date(mirror.last_verified);
            return !isNaN(verifiedDate.getTime()) && verifiedDate >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        } catch (e) {
            return false;
        }
    }

    // 创建镜像下拉菜单
    function createMirrorDropdown(id, label, mirrors) {
        if (mirrors.length === 0) {
            return `<div class="mirror-group">
                <button class="mirror-toggle" disabled>${label} (无安全镜像)</button>
            </div>`;
        }

        return `<div class="mirror-group">
            <button class="mirror-toggle" data-target="${id}">${label} (${mirrors.length}个镜像)</button>
            <div id="${id}" class="mirror-dropdown">
                ${mirrors.map(m => `
                    <a href="${m.url}" target="_blank" class="mirror-link">
                        ${m.domain}（验证于${m.last_verified}）
                    </a>
                `).join('')}
            </div>
        </div>`;
    }

    // API Key管理
    function loadApiKeys() {
        const keys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
        keyListUl.innerHTML = keys.length === 0 
            ? '<li class="no-keys">暂无保存的API Key</li>'
            : keys.map((key, i) => `
                <li>
                    <span>${key.slice(0, 8)}...${key.slice(-4)}</span>
                    <button class="delete-key" data-index="${i}">×</button>
                </li>
            `).join('');
    }

    function addApiKey() {
        const key = apiKeyInput.value.trim();
        if (!key) {
            showInfo('请输入API Key', 'warning');
            return;
        }
        const keys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
        keys.push(key);
        localStorage.setItem('geminiApiKeys', JSON.stringify(keys));
        apiKeyInput.value = '';
        loadApiKeys();
        showInfo('API Key添加成功', 'success');
    }

    function handleDeleteKey(e) {
        if (e.target.classList.contains('delete-key')) {
            const index = parseInt(e.target.dataset.index);
            const keys = JSON.parse(localStorage.getItem('geminiApiKeys') || '[]');
            keys.splice(index, 1);
            localStorage.setItem('geminiApiKeys', JSON.stringify(keys));
            loadApiKeys();
        }
    }

    // 信息提示工具
    function showInfo(message, type) {
        infoBox.textContent = message;
        infoBox.className = `info-box ${type}`;
        infoBox.style.display = message ? 'block' : 'none';
    }
});
