// /functions/proxy.js - 终极形态：智能API代理 + 专职ManyBooks爬虫

// =======================================================
// 主路由函数：根据请求类型分发任务
// =======================================================
export async function onRequest(context) {
    const { request } = context;

    // 我们只处理POST请求，通过请求体内容来区分任务类型
    if (request.method !== 'POST') {
        return new Response('Invalid request method. Only POST is accepted.', { status: 405 });
    }

    try {
        const requestData = await request.json();
        const { apiKey, body, scrapeTask } = requestData;

        // 如果请求中包含 scrapeTask，则分发到爬虫处理器
        if (scrapeTask && scrapeTask.target === 'manybooks') {
            return handleManyBooksScraper(scrapeTask.query);
        }

        // 否则，正常处理 Gemini API 请求
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
// 模式一：处理 Gemini API 的函数
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
// 模式二：专职处理 ManyBooks 爬取任务的函数
// =======================================================
async function handleManyBooksScraper(query) {
    try {
        // --- 第一步: 搜索书籍并获取详情页链接 ---
        const searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(query)}`;
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36' };

        const searchResponse = await fetch(searchUrl, { headers });
        if (!searchResponse.ok) throw new Error(`ManyBooks search failed with status: ${searchResponse.status}`);

        let bookDetailUrl = null;
        // 使用 HTMLRewriter 解析搜索结果，找到第一本书的链接
        // 注意：这个CSS选择器是根据manybooks当前结构来的，未来可能改变
        await new HTMLRewriter()
            .on('div.book-list-item-content > a', {
                element(element) {
                    if (!bookDetailUrl) { // 只取第一个最相关的结果
                        bookDetailUrl = new URL(element.getAttribute('href'), 'https://manybooks.net').href;
                    }
                },
            })
            .transform(searchResponse)
            .text(); // 必须消耗掉响应体来触发解析

        if (!bookDetailUrl) {
            // 如果搜索页没找到任何结果，返回空数组
            return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        // --- 第二步: 访问详情页并抓取下载链接 ---
        const detailResponse = await fetch(bookDetailUrl, { headers });
        if (!detailResponse.ok) throw new Error(`ManyBooks detail page failed with status: ${detailResponse.status}`);

        const downloadLinks = [];
        // 使用 HTMLRewriter 解析详情页，找到所有下载按钮的链接
        await new HTMLRewriter()
            .on('div.download-btns a.btn', {
                element(element) {
                    const format = element.getText({ text: true }).trim();
                    const url = element.getAttribute('href');
                    if (format && url) {
                        downloadLinks.push({
                            format: format.toUpperCase(),
                            url: new URL(url, 'https://manybooks.net').href
                        });
                    }
                },
            })
            .transform(detailResponse)
            .text();

        // 返回找到的下载链接数组
        return new Response(JSON.stringify(downloadLinks), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('ManyBooks Scraper Error:', error);
        return new Response(JSON.stringify({ error: 'Failed to scrape ManyBooks', details: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
