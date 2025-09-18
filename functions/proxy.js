// /functions/proxy.js - 优化后：增强manybooks爬虫稳定性与准确性

// =======================================================
// 主路由函数：根据请求类型分发任务
// =======================================================
export async function onRequest(context) {
    const { request } = context;

    if (request.method !== 'POST') {
        return new Response('Invalid request method. Only POST is accepted.', { status: 405 });
    }

    try {
        const requestData = await request.json();
        const { apiKey, body, scrapeTask } = requestData;

        if (scrapeTask && scrapeTask.target === 'manybooks') {
            return handleManyBooksScraper(scrapeTask.query, scrapeTask.title, scrapeTask.author); // 新增标题和作者参数用于精准匹配
        }

        if (!apiKey || !body) {
            return new Response(JSON.stringify({ error: 'Missing apiKey or body for Gemini API call' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return handleGeminiApiProxy(apiKey, body);

    } catch (error) {
        console.error('Proxy Error:', error);
        return new Response(JSON.stringify({ error: 'Proxy server error', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

// =======================================================
// 模式一：处理 Gemini API 的函数（保持不变）
// =======================================================
async function handleGeminiApiProxy(apiKey, body) {
    const modelName = 'gemini-2.5-pro';
    const googleApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const googleResponse = await fetch(googleApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    
    return new Response(googleResponse.body, {
        status: googleResponse.status,
        headers: googleResponse.headers,
    });
}

// =======================================================
// 模式二：优化后的 ManyBooks 爬虫函数
// =======================================================
async function handleManyBooksScraper(query, targetTitle = '', targetAuthor = '') {
    // 模拟真实浏览器的请求头（降低被反爬识别的概率）
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.8,en-US;q=0.5,en;q=0.3',
        'Referer': 'https://manybooks.net/',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    };

    // 重试函数（应对临时网络错误）
    const fetchWithRetry = async (url, options, retries = 2, delay = 1000) => {
        try {
            const response = await fetch(url, options);
            if (!response.ok && retries > 0) {
                console.log(`Request failed (${response.status}), retrying... (${retries} left)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(url, options, retries - 1, delay * 2); // 指数退避延迟
            }
            return response;
        } catch (error) {
            if (retries > 0) {
                console.log(`Fetch error: ${error.message}, retrying... (${retries} left)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(url, options, retries - 1, delay * 2);
            }
            throw error;
        }
    };

    try {
        // --- 第一步: 搜索书籍并获取最相关的详情页链接 ---
        const searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(query)}`;
        console.log(`Searching ManyBooks for: ${query}, URL: ${searchUrl}`);

        const searchResponse = await fetchWithRetry(searchUrl, { headers });
        if (!searchResponse.ok) {
            throw new Error(`Search request failed with status: ${searchResponse.status}`);
        }

        // 存储所有搜索结果（包含标题、作者、详情页链接）
        const searchResults = [];
        // 备选选择器（应对网站结构变化）
        const searchItemSelectors = [
            'div.book-list-item-content', // 主选择器
            'div.book-item', // 备选1
            'article.book-result' // 备选2
        ];

        // 解析搜索结果，提取标题、作者、详情页链接
        await new HTMLRewriter()
            .on(searchItemSelectors.join(', '), { // 同时监听多个选择器
                element(element) {
                    // 提取标题（优先从链接文本获取，备选从单独的标题元素）
                    const titleEl = element.querySelector('a');
                    const title = titleEl ? titleEl.getAttribute('title') || titleEl.text.trim() : '';
                    
                    // 提取作者（假设作者在标题附近的元素中）
                    const authorEl = element.querySelector('.book-author, .author');
                    const author = authorEl ? authorEl.text.trim().replace('by ', '').trim() : '';
                    
                    // 提取详情页链接
                    const detailUrl = titleEl ? new URL(titleEl.getAttribute('href'), 'https://manybooks.net').href : '';
                    
                    if (title && detailUrl) {
                        searchResults.push({ title, author, detailUrl });
                    }
                }
            })
            .transform(searchResponse.clone()) // 克隆响应，避免被消耗后无法再次使用
            .text();

        if (searchResults.length === 0) {
            return new Response(JSON.stringify({ 
                error: 'No search results found', 
                details: `No books matched the query: ${query}` 
            }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // --- 第二步: 从搜索结果中匹配最相关的图书（基于标题和作者） ---
        let bestMatch = null;
        const queryLower = query.toLowerCase();
        const targetTitleLower = targetTitle.toLowerCase();
        const targetAuthorLower = targetAuthor.toLowerCase();

        for (const result of searchResults) {
            const titleLower = result.title.toLowerCase();
            const authorLower = result.author.toLowerCase();
            
            // 匹配逻辑：标题包含目标标题 或 作者包含目标作者 或 标题/作者包含搜索关键词
            const titleMatch = targetTitle ? titleLower.includes(targetTitleLower) : titleLower.includes(queryLower);
            const authorMatch = targetAuthor ? authorLower.includes(targetAuthorLower) : false;
            
            if (titleMatch || authorMatch) {
                bestMatch = result;
                break; // 取第一个匹配项
            }
        }

        // 如果没有精准匹配，退而求其次取第一个结果
        const selectedResult = bestMatch || searchResults[0];
        console.log(`Selected book: ${selectedResult.title} by ${selectedResult.author}, URL: ${selectedResult.detailUrl}`);

        // --- 第三步: 访问详情页并抓取下载链接 ---
        const detailResponse = await fetchWithRetry(selectedResult.detailUrl, { headers });
        if (!detailResponse.ok) {
            throw new Error(`Detail page request failed with status: ${detailResponse.status}, URL: ${selectedResult.detailUrl}`);
        }

        const downloadLinks = [];
        // 下载链接的备选选择器
        const downloadBtnSelectors = [
            'div.download-btns a.btn', // 主选择器
            'div.download-options a', // 备选1
            'a.download-link' // 备选2
        ];

        await new HTMLRewriter()
            .on(downloadBtnSelectors.join(', '), { // 同时监听多个选择器
                element(element) {
                    // 提取格式（如 PDF、EPUB）
                    const formatText = element.text.trim().toLowerCase();
                    const format = formatText.match(/(pdf|epub|mobi|txt)/)?.[0]?.toUpperCase();
                    
                    // 提取下载链接（处理相对路径）
                    let url = element.getAttribute('href');
                    if (url) {
                        url = new URL(url, 'https://manybooks.net').href;
                    }
                    
                    if (format && url) {
                        downloadLinks.push({ format, url });
                    }
                }
            })
            .transform(detailResponse)
            .text();

        if (downloadLinks.length === 0) {
            return new Response(JSON.stringify({ 
                error: 'No download links found', 
                details: `Detail page has no valid download links: ${selectedResult.detailUrl}` 
            }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // 返回匹配的图书信息和下载链接
        return new Response(JSON.stringify({
            bookInfo: {
                title: selectedResult.title,
                author: selectedResult.author,
                detailUrl: selectedResult.detailUrl
            },
            downloadLinks
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error('ManyBooks Scraper Error:', error);
        return new Response(JSON.stringify({ 
            error: 'Failed to scrape ManyBooks', 
            details: error.message 
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
