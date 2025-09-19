// /functions/proxy.js - 完全重写的爬虫代码
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
        
        // 如果没有找到结果，尝试备用搜索策略
        if (bookLinks.length === 0) {
            console.log(`尝试备用搜索策略: ${query}`);
            bookLinks = await fallbackSearch(target, query, isbn, author);
        }
        
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

// 小立盘爬虫 - 完全重写
async function scrapeXiaolipan(query, isbn, author) {
    try {
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
            'Pragma': 'no-cache',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1'
        };
        
        // 添加随机延迟以避免被阻止
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`小立盘搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用更灵活的正则表达式匹配
        const regex = /<a[^>]*href="(\/p\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2]) {
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                const url = `https://www.xiaolipan.com${match[1]}`;
                
                // 过滤掉不相关的结果
                if (title && title.length > 5 && 
                    !title.includes('小立盘') && 
                    !title.includes('首页') && 
                    !title.includes('关于我们') &&
                    !title.includes('联系我们')) {
                    
                    const relevance = calculateRelevance(title, query, author);
                    
                    if (relevance > 5) {
                        bookDetails.push({
                            site: '小立盘',
                            title: title,
                            detailUrl: url,
                            downloadUrl: url.replace('/p/', '/download/'),
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
        }
        
        // 去重并按相关性排序
        const uniqueBooks = [];
        const seenUrls = new Set();
        
        for (const book of bookDetails) {
            if (!seenUrls.has(book.detailUrl)) {
                seenUrls.add(book.detailUrl);
                uniqueBooks.push(book);
            }
        }
        
        uniqueBooks.sort((a, b) => b.relevance - a.relevance);
        return uniqueBooks.slice(0, 5);
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return [];
    }
}

// Book5678爬虫 - 完全重写
async function scrapeBook5678(query, isbn, author) {
    try {
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
            'Pragma': 'no-cache',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1'
        };
        
        // 添加随机延迟
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`Book5678搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用正则表达式匹配
        const regex = /<a[^>]*href="(\/post\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2]) {
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                const url = `https://book5678.com${match[1]}`;
                
                // 过滤掉不相关的结果
                if (title && title.length > 5 && 
                    !title.includes('book5678') && 
                    !title.includes('首页') && 
                    !title.includes('关于我们') &&
                    !title.includes('联系我们')) {
                    
                    const relevance = calculateRelevance(title, query, author);
                    
                    if (relevance > 5) {
                        bookDetails.push({
                            site: 'Book5678',
                            title: title,
                            detailUrl: url,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
        }
        
        // 去重并按相关性排序
        const uniqueBooks = [];
        const seenUrls = new Set();
        
        for (const book of bookDetails) {
            if (!seenUrls.has(book.detailUrl)) {
                seenUrls.add(book.detailUrl);
                uniqueBooks.push(book);
            }
        }
        
        uniqueBooks.sort((a, b) => b.relevance - a.relevance);
        return uniqueBooks.slice(0, 5);
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return [];
    }
}

// 35PPT爬虫 - 完全重写
async function scrape35PPT(query, isbn, author) {
    try {
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
            'Pragma': 'no-cache',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1'
        };
        
        // 添加随机延迟
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`35PPT搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用正则表达式匹配
        const regex = /<a[^>]*href="(\/\d+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2]) {
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                const url = `https://www.35ppt.com${match[1]}`;
                const idMatch = url.match(/\/(\d+)\.html$/);
                
                // 过滤掉不相关的结果
                if (title && title.length > 5 && 
                    !title.includes('35PPT') && 
                    !title.includes('首页') && 
                    !title.includes('关于我们') &&
                    !title.includes('联系我们') &&
                    idMatch && idMatch[1]) {
                    
                    const relevance = calculateRelevance(title, query, author);
                    
                    if (relevance > 5) {
                        bookDetails.push({
                            site: '35PPT',
                            title: title,
                            detailUrl: url,
                            downloadUrl: `https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=${idMatch[1]}`,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            }
        }
        
        // 去重并按相关性排序
        const uniqueBooks = [];
        const seenUrls = new Set();
        
        for (const book of bookDetails) {
            if (!seenUrls.has(book.detailUrl)) {
                seenUrls.add(book.detailUrl);
                uniqueBooks.push(book);
            }
        }
        
        uniqueBooks.sort((a, b) => b.relevance - a.relevance);
        return uniqueBooks.slice(0, 5);
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return [];
    }
}

// 备用搜索策略
async function fallbackSearch(target, query, isbn, author) {
    console.log(`使用备用搜索策略: ${target} - ${query}`);
    
    // 尝试拆分查询词
    const queryWords = query.split(/\s+/);
    let results = [];
    
    // 尝试使用单个关键词搜索
    for (const word of queryWords) {
        if (word.length > 1) { // 只处理长度大于1的关键词
            let wordResults = [];
            
            switch (target) {
                case 'xiaolipan':
                    wordResults = await scrapeXiaolipan(word, isbn, author);
                    break;
                case 'book5678':
                    wordResults = await scrapeBook5678(word, isbn, author);
                    break;
                case '35ppt':
                    wordResults = await scrape35PPT(word, isbn, author);
                    break;
            }
            
            // 合并结果
            results = [...results, ...wordResults];
            
            // 添加延迟避免请求过快
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    // 去重并按相关性排序
    const uniqueBooks = [];
    const seenUrls = new Set();
    
    for (const book of results) {
        if (!seenUrls.has(book.detailUrl)) {
            seenUrls.add(book.detailUrl);
            uniqueBooks.push(book);
        }
    }
    
    uniqueBooks.sort((a, b) => b.relevance - a.relevance);
    return uniqueBooks.slice(0, 5);
}

// 智能相关性计算函数 - 改进版
function calculateRelevance(title, query, author) {
    let score = 0;
    
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
            score += 15;
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
    
    // 5. 检查标题长度 - 过短的标题可能是导航元素
    if (title.length < 5) {
        score -= 50;
    }
    
    // 6. 检查是否包含网站名称 - 排除导航元素
    if (lowerTitle.includes("小立盘") || lowerTitle.includes("book5678") || lowerTitle.includes("35ppt")) {
        score -= 100;
    }
    
    // 7. 检查是否包含导航文本
    const navigationTerms = ["首页", "关于我们", "联系我们", "登录", "注册", "搜索"];
    for (const term of navigationTerms) {
        if (lowerTitle.includes(term.toLowerCase())) {
            score -= 100;
            break;
        }
    }
    
    return Math.max(0, score);
}
