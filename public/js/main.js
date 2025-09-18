document.addEventListener('DOMContentLoaded', () => {
    // =======================================================
    // 配置区域
    // =======================================================
    const PROXY_ENDPOINT = '/proxy';
    const API_TIMEOUT_MS = 60000;
    const ZLIB_OFFICIAL_DOMAIN = "https://zh.z-lib.gd";
    
    // 镜像发现功能配置
    const MIRROR_DISCOVERY_ENABLED = true;
    const SAFETY_CHECK_ENABLED = true;
    const MIRROR_CACHE_DURATION = 60 * 60 * 1000;

    // =======================================================
    // DOM元素获取
    // =======================================================
    const searchBtn = document.getElementById('search-btn');
    const queryInput = document.getElementById('query-input');
    const resultsContainer = document.getElementById('results-container');
    const loadingSpinner = document.getElementById('loading-spinner');
    const infoBox = document.getElementById('info-box');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const addKeyBtn = document.getElementById('add-key-btn');
    const apiKeyInput = document.getElementById('api-key-input');
    const keyListUl = document.getElementById('key-list-ul');

    let apiKeys = [];
    let currentKeyIndex = 0;

    // =======================================================
    // 主处理函数
    // =======================================================
    async function handleSearch() {
        if (apiKeys.length === 0) { alert("请先设置 API Key。"); return; }
        const query = queryInput.value.trim();
        if (query === "") { alert("请输入您的阅读需求！"); return; }
        
        currentKeyIndex = 0;
        infoBox.style.display = 'none';
        setLoadingState(true, '正在生成全方位阅读报告...');

        try {
            const finalReport = await fetchAIResponseWithProxy({ body: buildUltimatePrompt(query) });
            displayResults(finalReport);
        } catch (error) {
            console.error('最终错误:', error);
            displayError(error.message);
        } finally {
            setLoadingState(false);
        }
    }

    // =======================================================
    // 终极的、唯一的AI Prompt构建函数
    // =======================================================
    function buildUltimatePrompt(userQuery) {
        const instruction = `
你是一个全能的、严谨的图书情报专家。你的任务是根据用户的单一请求，一次性生成一个包含完整阅读计划、资源可用性和访问路径的、高度结构化的JSON报告。

**CRITICAL SAFETY RULE: 你的最首要、不可妥协的职责是确保用户安全。你必须严格审查你提供的每一个URL。绝对禁止 (ABSOLUTELY PROHIBIT) 提供任何已知托管成人内容、恶意软件、赌博或任何与图书无关的非法信息的网站。如果一个域名曾经是图书网站但现在被用于其他目的，你必须将其排除。**

**最终JSON报告的结构必须如下：**
{
  "reading_plan": {
    "planTitle": "...",
    "books": [
      {
        "stage": "...",
        "title": "...",
        "author": "...",
        "isbn_13": "978...", // 如果可能，提供13位ISBN号，若无则为null
        "summary": "...",
        "reason": "...",
        "searchQuery": "..."
      }
    ]
  },
  "resource_access": {
    "anna_archive": ["安全的镜像URL数组"],
    "z_library": ["安全的镜像URL数组"]
  }
}

**执行指令:**
1. **阅读计划**: 创建一个包含3-5本书的结构化阅读计划。
2. **事实核查**: 直接使用最权威的书名和作者。
3. **ISBN获取**: 尽最大努力为每本书找到13位ISBN号。
4. **资源访问**: 严格遵守上述安全规则，提供经过安全审查的 Anna's Archive 和 Z-Library 的可用镜像列表。
5. **严格的单一JSON输出**: 你的整个回答必须是且仅是这一个符合上述结构的JSON对象。
`;
        return {
            contents: [{ role: "user", parts: [{ text: instruction }, { text: "这是用户的原始阅读需求：" }, { text: userQuery }] }],
            generationConfig: { response_mime_type: "application/json" }
        };
    }

    // =======================================================
    // 智能镜像发现与安全验证模块
    // =======================================================
    async function fetchAIVerifiedMirrors(target) {
        // 检查缓存
        const cacheKey = `mirrors_${target}`;
        const cached = getCachedMirrors(cacheKey);
        if (cached && cached.length > 0) {
            console.log(`使用缓存的镜像: ${target}`);
            return cached;
        }

        if (!MIRROR_DISCOVERY_ENABLED) {
            console.warn('智能镜像发现功能未启用，将使用备用镜像。');
            return getFallbackMirrors(target);
        }

        try {
            // 构建一个专门用于获取和验证镜像的Prompt
            const mirrorPrompt = buildMirrorDiscoveryPrompt(target);
            const response = await fetchAIResponseWithProxy({
                body: {
                    contents: [{
                        role: "user",
                        parts: [{ text: mirrorPrompt }]
                    }],
                    generationConfig: {
                        response_mime_type: "application/json"
                    }
                }
            });

            // 解析AI返回的JSON，应包含verified_mirrors数组
            const verifiedData = JSON.parse(extractJson(response));
            const proposedMirrors = verifiedData.verified_mirrors || [];

            if (proposedMirrors.length === 0) {
                throw new Error("AI未返回任何推荐的镜像。");
            }

            // 可选：二次验证
            let safeMirrors = proposedMirrors;
            if (SAFETY_CHECK_ENABLED) {
                safeMirrors = await quicklyVerifyMirrors(proposedMirrors);
            }

            // 缓存结果
            if (safeMirrors.length > 0) {
                cacheMirrors(cacheKey, safeMirrors);
                return safeMirrors;
            } else {
                return getFallbackMirrors(target);
            }

        } catch (error) {
            console.error(`获取AI验证的${target}镜像失败:`, error);
            return getFallbackMirrors(target);
        }
    }

    function buildMirrorDiscoveryPrompt(targetSite) {
        const siteName = targetSite === 'anna_archive' ? "Anna's Archive" : "Z-Library";
        return `
你是一名专业的网络安全和图书情报助手。你的唯一任务是发现并提供最新、可访问且绝对安全的${siteName}镜像站点。

**指令：**
1.  **发现镜像**：利用你的知识库或网络搜索能力（如果允许），找出当前最新、最稳定的${siteName}镜像站点URL（最多5个）。
2.  **严格安全审查**：你必须对你提供的每一个镜像URL进行严格的安全性和内容审查。**绝对禁止**返回任何已知或疑似包含以下内容的网站：
    - 成人内容、色情、赌博
    - 恶意软件、网络钓鱼、诈骗
    - 任何违法信息或非法内容
    - 大量弹出广告或误导性链接
    *注意：如果一个域名曾经是图书网站但现在被用于其他不良目的，你必须将其排除。*
3.  **验证可访问性**：优先推荐那些从中国地区网络环境较易访问的镜像。
4.  **输出格式**：你必须且只能返回一个JSON对象，格式如下：
    {
      "verified_mirrors": ["https://safe-mirror1.example", "https://safe-mirror2.example", ...]
    }

**请开始执行任务，确保你返回的所有镜像URL都是干净、安全且专用于图书获取的。**
`;
    }

    async function quicklyVerifyMirrors(mirrorUrls) {
        const verificationPromises = mirrorUrls.map(async (url) => {
            try {
                const parsedUrl = new URL(url);
                const suspiciousKeywords = ['porn', 'adult', 'casino', 'gambling', 'xxx', 'malware', 'scam'];
                const domain = parsedUrl.hostname;

                // 简单检查域名中是否包含可疑关键词
                if (suspiciousKeywords.some(keyword => domain.includes(keyword))) {
                    console.warn(`镜像URL因包含可疑关键词被过滤: ${url}`);
                    return null;
                }

                return url;
            } catch (error) {
                console.warn(`验证镜像URL时出错 (${url}):`, error);
                return null;
            }
        });

        const results = await Promise.all(verificationPromises);
        return results.filter(url => url !== null);
    }

    function getFallbackMirrors(target) {
        const fallbackMirrors = {
            anna_archive: [
                "https://annas-archive.org",
                "https://annas-archive.gs",
            ],
            z_library: [
                "https://zh.z-lib.gd",
                "https://z-library.wwwnav.com",
                "https://zlibrary.2rdh.com",
            ]
        };
        return fallbackMirrors[target] || [];
    }

    function getCachedMirrors(key) {
        try {
            const cached = localStorage.getItem(key);
            if (!cached) return null;
            
            const { timestamp, mirrors } = JSON.parse(cached);
            if (Date.now() - timestamp < MIRROR_CACHE_DURATION) {
                return mirrors;
            }
        } catch (e) {
            console.error('读取镜像缓存失败:', e);
        }
        return null;
    }

    function cacheMirrors(key, mirrors) {
        try {
            localStorage.setItem(key, JSON.stringify({
                timestamp: Date.now(),
                mirrors: mirrors
            }));
        } catch (e) {
            console.error('保存镜像缓存失败:', e);
        }
    }

    // =======================================================
    // 结果渲染函数
    // =======================================================
    async function displayResults(report) {
        resultsContainer.innerHTML = '';
        infoBox.style.display = 'block';
        const data = report?.reading_plan;
        const resourceList = report?.resource_access;
        
        if (!data || !data.planTitle || !Array.isArray(data.books) || !resourceList) {
            displayError("AI返回的报告结构不完整，无法解析。");
            return;
        }
        
        // 显示计划标题
        const planTitleElement = document.createElement('h2');
        planTitleElement.className = 'plan-title';
        planTitleElement.style.textAlign = 'center';
        planTitleElement.style.marginBottom = '20px';
        planTitleElement.textContent = data.planTitle;
        resultsContainer.appendChild(planTitleElement);
        
        // 显示"正在获取最新镜像"提示
        const mirrorLoadingDiv = document.createElement('div');
        mirrorLoadingDiv.id = 'mirror-loading';
        mirrorLoadingDiv.innerHTML = '<p>正在获取最新安全镜像...</p>';
        resultsContainer.appendChild(mirrorLoadingDiv);

        // 获取AI验证的镜像
        let annaMirrors = [];
        let zlibMirrors = [];
        
        try {
            [annaMirrors, zlibMirrors] = await Promise.all([
                fetchAIVerifiedMirrors('anna_archive'),
                fetchAIVerifiedMirrors('z_library')
            ]);
            
            // 移除加载提示
            mirrorLoadingDiv.remove();
        } catch (error) {
            console.error("获取镜像失败，使用报告中的或备用镜像:", error);
            mirrorLoadingDiv.innerHTML = '<p>获取最新镜像失败，使用备用镜像</p>';
            
            // 5秒后移除提示
            setTimeout(() => mirrorLoadingDiv.remove(), 5000);
            
            annaMirrors = resourceList.anna_archive || getFallbackMirrors('anna_archive');
            zlibMirrors = resourceList.z_library || getFallbackMirrors('z_library');
        }

        // 渲染每本书的卡片
        data.books.forEach((book, index) => {
            const card = document.createElement('div');
            card.className = 'result-card';
            const searchQuery = encodeURIComponent(book.searchQuery);

            const annaHtml = createDropdownHTML(`anna-archive-${index}`, "Anna's Archive", `https://annas-archive.org/search?q=${searchQuery}`, annaMirrors, `/search?q=${searchQuery}`);
            
            // Z-Library链接
            const zlibOfficialUrl = `${ZLIB_OFFICIAL_DOMAIN}/s?q=${searchQuery}`;
            const zlibHtml = createDropdownHTML(`z-library-${index}`, "Z-Library", zlibOfficialUrl, zlibMirrors, `/s?q=${searchQuery}`);

// 修改这行代码
const chineseSitesHtml = `
    <div class="chinese-sites-container">
        <button class="scrape-btn" data-target="xiaolipan" data-query="${book.title}" data-isbn="${book.isbn_13 || ''}" data-author="${book.author || ''}">从小立盘获取 ⏬</button>
        <button class="scrape-btn" data-target="book5678" data-query="${book.title}" data-isbn="${book.isbn_13 || ''}" data-author="${book.author || ''}">从Book5678获取 ⏬</button>
        <button class="scrape-btn" data-target="35ppt" data-query="${book.title}" data-isbn="${book.isbn_13 || ''}" data-author="${book.author || ''}">从35PPT获取 ⏬</button>
    </div>
`;
            
            let availabilityHtml = '';
            if (book.availability) {
                let statusClass = 'status-medium';
                if (book.availability.anna_archive_status === 'HIGHLY_LIKELY') statusClass = 'status-high';
                else if (book.availability.anna_archive_status === 'RARE') statusClass = 'status-low';
                availabilityHtml = `<div class="availability-section"><strong>资源可用性评估: </strong><span class="status-tag ${statusClass}">${book.availability.anna_archive_status.replace(/_/g, ' ')}</span><p class="availability-note">${book.availability.note}</p></div>`;
            }
            
            card.innerHTML = `
                <h2>${book.stage}</h2>
                <p class="book-title">${book.title} - ${book.author}</p>
                ${availabilityHtml}
                <p><strong>书籍简介：</strong>${book.summary}</p>
                <p><strong>推荐理由：</strong>${book.reason}</p>
                <div class="links-container">
                    ${annaHtml}
                    ${zlibHtml}
                    ${chineseSitesHtml}
                    <div class="direct-links-container" id="direct-links-${index}"></div>
                </div>
            `;
            resultsContainer.appendChild(card);
        });
    }

    // =======================================================
    // API调用函数
    // =======================================================
    async function fetchAIResponseWithProxy({ body, scrapeTask }) {
        if (apiKeys.length === 0 && !scrapeTask) {
             throw new Error("请先设置 API Key。");
        }
        let currentKey = null;
        if (!scrapeTask) {
            if (currentKeyIndex >= apiKeys.length) throw new Error("您提供的所有API Key都已尝试过或均无效/超时。");
            currentKey = apiKeys[currentKeyIndex];
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

        try {
            const payload = scrapeTask ? { scrapeTask } : { apiKey: currentKey, body };
            const response = await fetch(PROXY_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.details || errorData.error?.message || `服务器返回错误: ${response.status}`;
                throw new Error(errorMessage);
            }

            const data = await response.json();
            if (scrapeTask) return data;
            if (!data.candidates) throw new Error("API响应格式不正确。");
            return JSON.parse(extractJson(data.candidates[0].content.parts[0].text));
        } catch (error) {
            clearTimeout(timeoutId);
            if (!scrapeTask && (error.name === 'AbortError' || error instanceof TypeError || error.message.includes("服务器返回错误"))) {
                 currentKeyIndex++;
                 return fetchAIResponseWithProxy({ body, scrapeTask });
            }
            throw error;
        }
    }

// =======================================================
// 事件监听器
// =======================================================
resultsContainer.addEventListener('click', async (event) => {
    const target = event.target;
    if (target.classList.contains('toggle-btn')) {
        const targetId = target.dataset.target;
        const dropdown = document.getElementById(targetId);
        if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
    if (target.classList.contains('scrape-btn')) {
        const site = target.dataset.target;
        const query = target.dataset.query;
        const isbn = target.dataset.isbn;
        const author = target.dataset.author; // 新增作者信息
        const linksContainer = target.parentElement.parentElement.querySelector('.direct-links-container');
        
        target.textContent = '正在获取...';
        target.disabled = true;
        linksContainer.innerHTML = '';
        
        try {
            const bookLinks = await fetchAIResponseWithProxy({ 
                scrapeTask: { target: site, query, isbn, author } 
            });
            
            if (bookLinks && Array.isArray(bookLinks) && bookLinks.length > 0) {
                // 只显示相关性最高的3个结果
                const topResults = bookLinks.slice(0, 3);
                
                topResults.forEach(link => {
                    const div = document.createElement('div');
                    div.className = 'book-link-item';
                    
                    // 显示相关性评分（调试用）
                    const relevanceSpan = document.createElement('span');
                    relevanceSpan.className = 'relevance-score';
                    relevanceSpan.textContent = `相关度: ${link.relevance}`;
                    relevanceSpan.style.fontSize = '0.8em';
                    relevanceSpan.style.color = '#7f8c8d';
                    relevanceSpan.style.marginRight = '10px';
                    
                    // 创建详情页链接
                    const detailLink = document.createElement('a');
                    detailLink.href = link.detailUrl;
                    detailLink.textContent = `${link.site}: ${link.title}`;
                    detailLink.target = '_blank';
                    detailLink.className = 'book-detail-link';
                    
                    div.appendChild(relevanceSpan);
                    div.appendChild(detailLink);
                    
                    // 如果有下载页链接，也添加
                    if (link.downloadUrl) {
                        const downloadLink = document.createElement('a');
                        downloadLink.href = link.downloadUrl;
                        downloadLink.textContent = '下载页面';
                        downloadLink.target = '_blank';
                        downloadLink.className = 'book-download-link';
                        downloadLink.style.marginLeft = '10px';
                        
                        div.appendChild(downloadLink);
                    }
                    
                    linksContainer.appendChild(div);
                });
            } else {
                linksContainer.innerHTML = `<span class="scrape-not-found">未找到相关书籍。</span>`;
            }
        } catch (error) {
            console.error(`${site} scraper failed:`, error);
            linksContainer.innerHTML = `<span class="scrape-not-found">获取失败: ${error.message}</span>`;
        } finally {
            target.style.display = 'none';
        }
    }
});

    // =======================================================
    // 辅助函数
    // =======================================================
    function createDropdownHTML(id, label, officialUrl, mirrors, searchPath) {
        const links = [
            { url: officialUrl, name: "Official Site" },
            ...mirrors.map(m => {
                try {
                    return { url: `${new URL(m).origin}${searchPath}`, name: new URL(m).hostname };
                } catch {
                    return null;
                }
            }).filter(Boolean)
        ];
        
        let dropdownHtml = `<div class="mirror-links-dropdown" id="${id}" style="display:none;">`;
        links.forEach(link => {
            const isOfficial = link.name === "Official Site";
            dropdownHtml += `<a href="${link.url}" target="_blank" class="mirror-link ${isOfficial ? 'official-link' : ''}">${link.name} ${isOfficial ? ' (官网)' : ''}</a>`;
        });
        dropdownHtml += `</div>`;
        
        return `<div class="links-wrapper"><button class="toggle-btn" data-target="${id}">${label}</button>${dropdownHtml}</div>`;
    }
    
    function extractJson(text) {
        const match = text.match(/```json\s*([\s\S]*?)\s*```/);
        return match && match[1] ? match[1] : text;
    }
    
    function displayError(message) {
        setLoadingState(false);
        resultsContainer.innerHTML = `<div class="error-message"><h3>糟糕，出错了！</h3><p>${message}</p><p>请检查你的网络连接和API Key配置，然后重试。</p></div>`;
    }
    
    function setLoadingState(isLoading, message) {
        searchBtn.disabled = isLoading;
        if (isLoading) {
            searchBtn.textContent = message || "思考中...";
            resultsContainer.innerHTML = "";
            loadingSpinner.style.display = "block";
            resultsContainer.appendChild(loadingSpinner);
        } else {
            searchBtn.textContent = "生成阅读计划";
            loadingSpinner.style.display = "none";
        }
    }
    
    function loadKeysFromStorage() {
        const keys = localStorage.getItem("geminiApiKeys");
        apiKeys = keys ? JSON.parse(keys) : [];
        updateUIOnKeyChange();
        renderKeyList();
    }
    
    function saveKeysToStorage() {
        localStorage.setItem("geminiApiKeys", JSON.stringify(apiKeys));
    }
    
    function renderKeyList() {
        keyListUl.innerHTML = "";
        if (apiKeys.length === 0) {
            keyListUl.innerHTML = "<li>暂无 API Key。</li>";
            return;
        }
        
        apiKeys.forEach((key, index) => {
            const maskedKey = `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
            const li = document.createElement("li");
            li.innerHTML = `<span>${maskedKey}</span><button class="delete-key-btn" data-index="${index}" title="删除">&times;</button>`;
            keyListUl.appendChild(li);
        });
    }
    
    function addKey() {
        const key = apiKeyInput.value.trim();
        if (key && !apiKeys.includes(key)) {
            apiKeys.push(key);
            saveKeysToStorage();
            renderKeyList();
            updateUIOnKeyChange();
            apiKeyInput.value = "";
        } else if (apiKeys.includes(key)) {
            alert("这个 API Key 已经存在了。");
        }
    }
    
    function deleteKey(index) {
        apiKeys.splice(index, 1);
        saveKeysToStorage();
        renderKeyList();
        updateUIOnKeyChange();
    }
    
    function updateUIOnKeyChange() {
        if (apiKeys.length === 0) {
            searchBtn.disabled = true;
            searchBtn.textContent = "请先设置 API Key";
        } else {
            searchBtn.disabled = false;
            searchBtn.textContent = "生成阅读计划";
        }
    }

    // =======================================================
    // 初始化事件监听器
    // =======================================================
    searchBtn.addEventListener("click", handleSearch);
    settingsBtn.addEventListener("click", () => {
        settingsModal.style.display = "flex";
    });
    closeModalBtn.addEventListener("click", () => {
        settingsModal.style.display = "none";
    });
    settingsModal.addEventListener("click", (e) => {
        if (e.target === settingsModal) {
            settingsModal.style.display = "none";
        }
    });
    addKeyBtn.addEventListener("click", addKey);
    apiKeyInput.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
            addKey();
        }
    });
    keyListUl.addEventListener("click", (e) => {
        if (e.target.classList.contains("delete-key-btn")) {
            const index = parseInt(e.target.dataset.index, 10);
            deleteKey(index);
        }
    });

    // 初始化加载API Keys
    loadKeysFromStorage();
});
