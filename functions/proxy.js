// 代理服务：处理API请求转发和爬虫任务
export async function onRequest(context) {
    const { request } = context;

    // 仅允许POST请求
    if (request.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: '仅支持POST请求' }),
            { status: 405, headers: { 'Content-Type': 'application/json' } }
        );
    }

    try {
        const requestData = await request.json();
        const { apiKey, body, scrapeTask } = requestData;

        // 处理镜像爬虫任务（如果需要）
        if (scrapeTask && scrapeTask.target === 'manybooks') {
            return handleManyBooksScraper(scrapeTask.query);
        }

        // 处理Gemini API代理
        if (!apiKey || !body) {
            return new Response(
                JSON.stringify({ error: '缺少apiKey或请求体' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }
        return handleGeminiApiProxy(apiKey, body);

    } catch (error) {
        console.error('代理服务错误:', error);
        return new Response(
            JSON.stringify({ 
                error: '代理服务内部错误', 
                details: error.message 
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

// 代理Gemini API请求（核心修复跨域）
async function handleGeminiApiProxy(apiKey, body) {
    try {
        const modelName = 'gemini-pro';
        const googleApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        
        // 转发请求到Google API
        const googleResponse = await fetch(googleApiUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body),
        });

        // 构造带跨域头的响应
        const headers = new Headers(googleResponse.headers);
        headers.set('Access-Control-Allow-Origin', '*'); // 允许跨域（生产环境可限制为你的域名）
        headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');

        return new Response(googleResponse.body, {
            status: googleResponse.status,
            statusText: googleResponse.statusText,
            headers: headers
        });
    } catch (error) {
        console.error('Gemini API代理错误:', error);
        return new Response(
            JSON.stringify({ 
                error: '转发API请求失败', 
                details: error.message 
            }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

// ManyBooks爬虫（如需保留，可根据需要调整）
async function handleManyBooksScraper(query) {
    try {
        const searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(query)}`;
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`搜索失败: ${response.statusText}`);
        }

        // 此处仅返回示例数据，实际需根据网站结构解析
        return new Response(
            JSON.stringify({
                bookInfo: { title: '示例书籍', author: '未知作者' },
                downloadLinks: [{ format: 'PDF', url: 'https://example.com/book.pdf' }]
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: '爬虫失败', details: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
