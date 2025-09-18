document.addEventListener('DOMContentLoaded', () => {
    // =======================================================
    // 配置区域
    // =======================================================
    const PROXY_ENDPOINT = '/proxy';
    const API_TIMEOUT_MS = 60000;
    // 使用您提供的、经过验证的安全Z-Library官网域名
    const ZLIB_OFFICIAL_DOMAIN = "https://zh.z-lib.gd";

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
    // 主处理函数 (单次API调用)
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
    // 终极的、唯一的AI Prompt构建函数 (安全加固版)
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
    // 结果渲染函数 (恢复Z-Lib镜像并使用安全官网)
    // =======================================================
    function displayResults(report) {
        resultsContainer.innerHTML = '';
        infoBox.style.display = 'block';
        const data = report?.reading_plan;
        const resourceList = report?.resource_access;
        if (!data || !data.planTitle || !Array.isArray(data.books) || !resourceList) {
            displayError("AI返回的报告结构不完整，无法解析。");
            return;
        }
        const planTitleElement = document.createElement('h2');
        planTitleElement.className = 'plan-title';
        planTitleElement.style.textAlign = 'center';
        planTitleElement.style.marginBottom = '20px';
        planTitleElement.textContent = data.planTitle;
        resultsContainer.appendChild(planTitleElement);

        const annaMirrors = resourceList.anna_archive || [];
        const zlibMirrors = resourceList.z_library || [];

        data.books.forEach((book, index) => {
            const card = document.createElement('div');
            card.className = 'result-card';
            const searchQuery = encodeURIComponent(book.searchQuery);

            const annaHtml = createDropdownHTML(`anna-archive-${index}`, "Anna's Archive", `https://annas-archive.org/search?q=${searchQuery}`, annaMirrors, `/search?q=${searchQuery}`);
            
            // Z-Library链接，使用安全的硬编码官网地址 + 动态安全镜像
            const zlibOfficialUrl = `${ZLIB_OFFICIAL_DOMAIN}/s?q=${searchQuery}`;
            const zlibHtml = createDropdownHTML(`z-library-${index}`, "Z-Library", zlibOfficialUrl, zlibMirrors, `/s?q=${searchQuery}`);

            const manyBooksHtml = `<button class="scrape-btn" data-target="manybooks" data-query="${book.searchQuery}" data-isbn="${book.isbn_13 || ''}">从 ManyBooks 尝试获取 ⏬</button>`;
            
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
                    ${manyBooksHtml}
                    <div class="direct-links-container" id="direct-links-${index}"></div>
                </div>
            `;
            resultsContainer.appendChild(card);
        });
    }

    // =======================================================
    // 带有超时和健壮重试机制的API调用函数
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
    // 事件监听器 (委托爬虫按钮和下拉按钮)
    // =======================================================
    resultsContainer.addEventListener('click', async (event) => {
        const target = event.target;
        if (target.classList.contains('toggle-btn')) {
            const targetId = target.dataset.target;
            const dropdown = document.getElementById(targetId);
            if (dropdown) dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        }
        if (target.classList.contains('scrape-btn')) {
            const query = target.dataset.query;
            const isbn = target.dataset.isbn;
            const linksContainer = target.parentElement.querySelector('.direct-links-container');
            target.textContent = '正在获取...';
            target.disabled = true;
            linksContainer.innerHTML = '';
            try {
                const directLinks = await fetchAIResponseWithProxy({ scrapeTask: { target: 'manybooks', query, isbn } });
                if (directLinks && Array.isArray(directLinks) && directLinks.length > 0) {
                    directLinks.forEach(link => {
                        const a = document.createElement('a');
                        a.href = link.url;
                        a.textContent = `下载 ${link.format}`;
                        a.target = '_blank';
                        a.className = 'direct-download-link';
                        linksContainer.appendChild(a);
                    });
                } else {
                    linksContainer.innerHTML = `<span class="scrape-not-found">未找到直接下载资源。</span>`;
                }
            } catch (error) {
                console.error("Scraper failed:", error);
                linksContainer.innerHTML = `<span class="scrape-not-found">获取失败: ${error.message}</span>`;
            } finally {
                target.style.display = 'none';
            }
        }
    });

    // =======================================================
    // 其他所有辅助函数 (无变化)
    // =======================================================
    function createDropdownHTML(id,label,officialUrl,mirrors,searchPath){const links=[{url:officialUrl,name:"Official Site"},...mirrors.map(m=>{try{return{url:`${new URL(m).origin}${searchPath}`,name:new URL(m).hostname}}catch{return null}}).filter(Boolean)];let dropdownHtml=`<div class="mirror-links-dropdown" id="${id}" style="display:none;">`;links.forEach(link=>{const isOfficial=link.name==="Official Site";dropdownHtml+=`<a href="${link.url}" target="_blank" class="mirror-link ${isOfficial?'official-link':''}">${link.name} ${isOfficial?' (官网)':''}</a>`});dropdownHtml+=`</div>`;return`<div class="links-wrapper"><button class="toggle-btn" data-target="${id}">${label}</button>${dropdownHtml}</div>`}
    function extractJson(e){const t=e.match(/```json\s*([\s\S]*?)\s*```/);return t&&t[1]?t[1]:e}
    function displayError(e){setLoadingState(!1),resultsContainer.innerHTML=`<div class="error-message"><h3>糟糕，出错了！</h3><p>${e}</p><p>请检查你的网络连接和API Key配置，然后重试。</p></div>`}
    function setLoadingState(e,t){searchBtn.disabled=e,e?(searchBtn.textContent=t||"思考中...",resultsContainer.innerHTML="",loadingSpinner.style.display="block",resultsContainer.appendChild(loadingSpinner)):(searchBtn.textContent="生成阅读计划",loadingSpinner.style.display="none")}
    function loadKeysFromStorage(){const e=localStorage.getItem("geminiApiKeys");apiKeys=e?JSON.parse(e):[],updateUIOnKeyChange(),renderKeyList()}
    function saveKeysToStorage(){localStorage.setItem("geminiApiKeys",JSON.stringify(apiKeys))}
    function renderKeyList(){if(keyListUl.innerHTML="",0===apiKeys.length)return void(keyListUl.innerHTML="<li>暂无 API Key。</li>");apiKeys.forEach((e,t)=>{const s=`${e.substring(0,4)}...${e.substring(e.length-4)}`,o=document.createElement("li");o.innerHTML=`<span>${s}</span><button class="delete-key-btn" data-index="${t}" title="删除">&times;</button>`,keyListUl.appendChild(o)})}
    function addKey(){const e=apiKeyInput.value.trim();e&&!apiKeys.includes(e)?(apiKeys.push(e),saveKeysToStorage(),renderKeyList(),updateUIOnKeyChange(),apiKeyInput.value=""):apiKeys.includes(e)&&alert("这个 API Key 已经存在了。")}
    function deleteKey(e){apiKeys.splice(e,1),saveKeysToStorage(),renderKeyList(),updateUIOnKeyChange()}
    function updateUIOnKeyChange(){0===apiKeys.length?(searchBtn.disabled=!0,searchBtn.textContent="请先设置 API Key"):(searchBtn.disabled=!1,searchBtn.textContent="生成阅读计划")}
    searchBtn.addEventListener("click",handleSearch),settingsBtn.addEventListener("click",()=>{settingsModal.style.display="flex"}),closeModalBtn.addEventListener("click",()=>{settingsModal.style.display="none"}),settingsModal.addEventListener("click",e=>{e.target===settingsModal&&(settingsModal.style.display="none")}),addKeyBtn.addEventListener("click",addKey),apiKeyInput.addEventListener("keyup",e=>{"Enter"===e.key&&addKey()}),keyListUl.addEventListener("click",e=>{if(e.target.classList.contains("delete-key-btn")){const t=parseInt(e.target.dataset.index,10);deleteKey(t)}});
    loadKeysFromStorage();
});
