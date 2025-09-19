// /functions/proxy.js - 智能图书搜索代理

// =======================================================
// 主路由函数
// =======================================================
export async function onRequest(context) {
    const { request } = context;

    if (request.method !== 'POST') {
        return new Response('Invalid request method. Only POST is accepted.', { status: 405 });
    }

    try {
        const requestData = await request.json();
        const { apiKey, body, scrapeTask } = requestData;

        // 处理图书网站爬取任务
        if (scrapeTask && scrapeTask.target) {
            return handleBookSiteScraper(scrapeTask.target, scrapeTask.query, scrapeTask.isbn, scrapeTask.author);
        }

        // 处理 Gemini API 请求
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
// 处理 Gemini API 的函数
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
// 处理图书网站爬取的函数
// =======================================================
async function handleBookSiteScraper(target, query, isbn, author) {
    try {
        console.log(`开始爬取 ${target}: ${query}, ISBN: ${isbn}, 作者: ${author}`);
        
        let bookLinks = [];
        
        switch (target) {
            case 'xiaolipan':
                bookLinks = await scrapeXiaolipan(query, isbn, author);
                break;
            case 'book5678':
                bookLinks = await scrapeBook5678(query, isbn, author);
                break;
            case '35ppt':
                bookLinks = await scrape35PPT(query, isbn, author);
                break;
            default:
                throw new Error(`未知的目标网站: ${target}`);
        }
        
        console.log(`从 ${target} 获取到 ${bookLinks.length} 个书籍链接`);
        
        return new Response(JSON.stringify(bookLinks), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error(`${target} Scraper Error:`, error);
        return new Response(JSON.stringify({ 
            error: `Failed to scrape ${target}`, 
            details: error.message 
        }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
}

// =======================================================
// 小立盘 (xiaolipan.com) 爬取函数
// =======================================================
async function scrapeXiaolipan(query, isbn, author) {
    try {
        // 构建搜索URL
        const searchUrl = `https://www.xiaolipan.com/search.html?keyword=${encodeURIComponent(query)}`;
        console.log(`小立盘搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://www.xiaolipan.com/',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };
        
        // 执行搜索
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`小立盘搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 使用更智能的解析方法
        const bookDetails = await parseXiaolipanWithAI(html, query, author);
        
        return bookDetails;
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return [];
    }
}

// 使用AI辅助解析小立盘搜索结果
async function parseXiaolipanWithAI(html, query, author) {
    // 提取页面中的关键信息
    const pageText = extractTextFromHTML(html);
    
    // 使用Gemini API分析页面内容并提取书籍信息
    try {
        const prompt = `
请分析以下网页内容，提取与"${query}"相关的书籍信息。作者信息: ${author || '未知'}。

网页内容:
${pageText.substring(0, 3000)}  // 限制长度

请以JSON格式返回找到的书籍信息，格式如下:
{
  "books": [
    {
      "title": "书籍标题",
      "detailUrl": "详情页URL",
      "downloadUrl": "下载页URL",
      "relevance": 相关性分数(0-100)
    }
  ]
}

请确保URL是完整的，包括https://前缀。
`;
        
        const aiResponse = await fetchAIResponseWithProxy({
            body: {
                contents: [{
                    role: "user",
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    response_mime_type: "application/json"
                }
            }
        });
        
        const result = JSON.parse(aiResponse);
        return result.books || [];
        
    } catch (error) {
        console.error("AI解析失败，使用备用方法:", error);
        return parseXiaolipanFallback(html, query, author);
    }
}

// 备用解析方法
function parseXiaolipanFallback(html, query, author) {
    const bookDetails = [];
    
    try {
        // 使用多种模式尝试提取书籍信息
        const patterns = [
            // 尝试提取详情页链接
            /<a[^>]*href="(\/p\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/g,
            /<h3[^>]*>\s*<a[^>]*href="(\/p\/\d+\.html)"[^>]*>([^<]*)<\/a>\s*<\/h3>/gi,
            /<div[^>]*class="[^"]*book-item[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(\/p\/\d+\.html)"[^>]*>([^<]*)<\/a>[\s\S]*?<\/div>/gi
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                if (match[1] && match[2]) {
                    const title = match[2].trim();
                    const detailUrl = `https://www.xiaolipan.com${match[1]}`;
                    const downloadUrl = detailUrl.replace('/p/', '/download/');
                    
                    // 计算相关性
                    const relevance = calculateRelevance(title, query, author);
                    
                    if (relevance > 30) {
                        bookDetails.push({
                            site: '小立盘',
                            title: title,
                            detailUrl: detailUrl,
                            downloadUrl: downloadUrl,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
            
            // 如果找到结果，退出循环
            if (bookDetails.length > 0) break;
        }
        
        // 按相关性排序
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        
        return bookDetails.slice(0, 3); // 返回最多3个结果
        
    } catch (error) {
        console.error("备用解析方法失败:", error);
        return [];
    }
}

// =======================================================
// Book5678 (book5678.com) 爬取函数
// =======================================================
async function scrapeBook5678(query, isbn, author) {
    try {
        // 构建搜索URL
        const searchUrl = `https://book5678.com/search.php?q=${encodeURIComponent(query)}`;
        console.log(`Book5678搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://book5678.com/',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };
        
        // 执行搜索
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`Book5678搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 使用智能解析方法
        const bookDetails = await parseBook5678WithAI(html, query, author);
        
        return bookDetails;
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return [];
    }
}

// 使用AI辅助解析Book5678搜索结果
async function parseBook5678WithAI(html, query, author) {
    // 提取页面中的关键信息
    const pageText = extractTextFromHTML(html);
    
    // 使用Gemini API分析页面内容并提取书籍信息
    try {
        const prompt = `
请分析以下网页内容，提取与"${query}"相关的书籍信息。作者信息: ${author || '未知'}。

网页内容:
${pageText.substring(0, 3000)}  // 限制长度

请以JSON格式返回找到的书籍信息，格式如下:
{
  "books": [
    {
      "title": "书籍标题",
      "detailUrl": "详情页URL",
      "relevance": 相关性分数(0-100)
    }
  ]
}

请确保URL是完整的，包括https://前缀。
`;
        
        const aiResponse = await fetchAIResponseWithProxy({
            body: {
                contents: [{
                    role: "user",
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    response_mime_type: "application/json"
                }
            }
        });
        
        const result = JSON.parse(aiResponse);
        return result.books || [];
        
    } catch (error) {
        console.error("AI解析失败，使用备用方法:", error);
        return parseBook5678Fallback(html, query, author);
    }
}

// 备用解析方法
function parseBook5678Fallback(html, query, author) {
    const bookDetails = [];
    
    try {
        // 使用多种模式尝试提取书籍信息
        const patterns = [
            // 尝试提取详情页链接
            /<a[^>]*href="(\/post\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/g,
            /<h3[^>]*>\s*<a[^>]*href="(\/post\/\d+\.html)"[^>]*>([^<]*)<\/a>\s*<\/h3>/gi,
            /<div[^>]*class="[^"]*item[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(\/post\/\d+\.html)"[^>]*>([^<]*)<\/a>[\s\S]*?<\/div>/gi
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                if (match[1] && match[2]) {
                    const title = match[2].trim();
                    const detailUrl = `https://book5678.com${match[1]}`;
                    
                    // 计算相关性
                    const relevance = calculateRelevance(title, query, author);
                    
                    if (relevance > 30) {
                        bookDetails.push({
                            site: 'Book5678',
                            title: title,
                            detailUrl: detailUrl,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
            
            // 如果找到结果，退出循环
            if (bookDetails.length > 0) break;
        }
        
        // 按相关性排序
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        
        return bookDetails.slice(0, 3); // 返回最多3个结果
        
    } catch (error) {
        console.error("备用解析方法失败:", error);
        return [];
    }
}

// =======================================================
// 35PPT (35ppt.com) 爬取函数
// =======================================================
async function scrape35PPT(query, isbn, author) {
    try {
        // 构建搜索URL
        const searchUrl = `https://www.35ppt.com/?s=${encodeURIComponent(query)}`;
        console.log(`35PPT搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://www.35ppt.com/',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        };
        
        // 执行搜索
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`35PPT搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 使用智能解析方法
        const bookDetails = await parse35PPTWithAI(html, query, author);
        
        return bookDetails;
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return [];
    }
}

// 使用AI辅助解析35PPT搜索结果
async function parse35PPTWithAI(html, query, author) {
    // 提取页面中的关键信息
    const pageText = extractTextFromHTML(html);
    
    // 使用Gemini API分析页面内容并提取书籍信息
    try {
        const prompt = `
请分析以下网页内容，提取与"${query}"相关的书籍信息。作者信息: ${author || '未知'}。

网页内容:
${pageText.substring(0, 3000)}  // 限制长度

请以JSON格式返回找到的书籍信息，格式如下:
{
  "books": [
    {
      "title": "书籍标题",
      "detailUrl": "详情页URL",
      "downloadUrl": "下载页URL",
      "relevance": 相关性分数(0-100)
    }
  ]
}

请确保URL是完整的，包括https://前缀。
下载页URL格式应为: https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=数字ID
`;
        
        const aiResponse = await fetchAIResponseWithProxy({
            body: {
                contents: [{
                    role: "user",
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    response_mime_type: "application/json"
                }
            }
        });
        
        const result = JSON.parse(aiResponse);
        return result.books || [];
        
    } catch (error) {
        console.error("AI解析失败，使用备用方法:", error);
        return parse35PPTFallback(html, query, author);
    }
}

// 备用解析方法
function parse35PPTFallback(html, query, author) {
    const bookDetails = [];
    
    try {
        // 使用多种模式尝试提取书籍信息
        const patterns = [
            // 尝试提取详情页链接和ID
            /<a[^>]*href="(\/(\d+)\.html)"[^>]*title="([^"]*)"[^>]*>/g,
            /<h2[^>]*>\s*<a[^>]*href="(\/(\d+)\.html)"[^>]*>([^<]*)<\/a>\s*<\/h2>/gi,
            /<article[^>]*>[\s\S]*?<a[^>]*href="(\/(\d+)\.html)"[^>]*>([^<]*)<\/a>[\s\S]*?<\/article>/gi
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                if (match[1] && match[2] && match[3]) {
                    const title = match[3].trim();
                    const detailUrl = `https://www.35ppt.com${match[1]}`;
                    const id = match[2];
                    const downloadUrl = `https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=${id}`;
                    
                    // 计算相关性
                    const relevance = calculateRelevance(title, query, author);
                    
                    if (relevance > 30) {
                        bookDetails.push({
                            site: '35PPT',
                            title: title,
                            detailUrl: detailUrl,
                            downloadUrl: downloadUrl,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
            
            // 如果找到结果，退出循环
            if (bookDetails.length > 0) break;
        }
        
        // 按相关性排序
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        
        return bookDetails.slice(0, 3); // 返回最多3个结果
        
    } catch (error) {
        console.error("备用解析方法失败:", error);
        return [];
    }
}

// =======================================================
// 辅助函数
// =======================================================

// 从HTML中提取文本内容
function extractTextFromHTML(html) {
    // 移除脚本和样式标签
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // 移除HTML标签
    text = text.replace(/<[^>]*>/g, ' ');
    
    // 合并多个空格和换行
    text = text.replace(/\s+/g, ' ');
    
    // 解码HTML实体
    text = text.replace(/&nbsp;/g, ' ')
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'");
    
    return text.trim();
}

// 计算搜索结果的相关性分数
function calculateRelevance(title, query, author) {
    let score = 0;
    
    // 转换为小写以便比较
    const lowerTitle = title.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const lowerAuthor = author ? author.toLowerCase() : '';
    
    // 1. 检查标题是否完全包含查询词
    if (lowerTitle.includes(lowerQuery)) {
        score += 50;
    }
    
    // 2. 检查标题是否包含查询词的主要部分
    const queryWords = lowerQuery.split(/\s+/);
    let matchedWords = 0;
    
    for (const word of queryWords) {
        if (word.length > 1 && lowerTitle.includes(word)) {
            matchedWords++;
            score += 10;
        }
    }
    
    // 3. 检查标题是否包含作者名
    if (lowerAuthor && lowerTitle.includes(lowerAuthor)) {
        score += 30;
    }
    
    // 4. 检查是否是完全匹配
    if (lowerTitle === lowerQuery) {
        score += 100;
    }
    
    return score;
}

// AI辅助解析的API调用函数
async function fetchAIResponseWithProxy({ body }) {
    // 这里需要实现调用Gemini API的逻辑
    // 由于这是一个独立的函数，需要确保有可用的API key
    // 简化实现，实际使用时需要完整实现
    
    const modelName = 'gemini-2.5-pro';
    const apiKey = ''; // 需要从环境中获取
    
    if (!apiKey) {
        throw new Error("No API key available for AI parsing");
    }
    
    const googleApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const response = await fetch(googleApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    
    if (!response.ok) {
        throw new Error(`AI API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.candidates) {
        throw new Error("AI API response format incorrect");
    }
    
    // 提取JSON响应
    const text = data.candidates[0].content.parts[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
        throw new Error("No JSON found in AI response");
    }
    
    return JSON.parse(jsonMatch[0]);
}
