// /functions/proxy.js - 完整版本
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
            return await handleBookSiteScraper(scrapeTask.target, scrapeTask.query, scrapeTask.isbn, scrapeTask.author);
        }

        // 处理 Gemini API 请求
        if (!apiKey || !body) {
            return new Response(JSON.stringify({ error: 'Missing apiKey or body for Gemini API call' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        return await handleGeminiApiProxy(apiKey, body);

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
        
        // 如果仍然没有结果，尝试使用关键词组合搜索
        if (bookLinks.length === 0) {
            console.log(`尝试关键词组合搜索: ${query}`);
            bookLinks = await keywordCombinationSearch(target, query, isbn, author);
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

// 小立盘爬虫
async function scrapeXiaolipan(query, isbn, author) {
    try {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://www.xiaolipan.com/search.html?keyword=${encodedQuery}`;
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
        
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`小立盘搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 方法1: 使用正则表达式匹配
        try {
            const regex = /<a[^>]*href="(\/p\/[^"]*)"[^>]*>([^<]*)<\/a>/g;
            let match;
            
            while ((match = regex.exec(html)) !== null) {
                if (match[1] && match[2]) {
                    const title = match[2].trim();
                    const url = `https://www.xiaolipan.com${match[1]}`;
                    
                    if (title && title.length > 5 && !isNavigationElement(title)) {
                        const relevance = calculateRelevance(title, query, author);
                        if (relevance > 10) {
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
        } catch (error) {
            console.error("正则表达式解析失败:", error);
        }
        
        // 方法2: 尝试查找包含特定类的元素
        if (bookDetails.length === 0) {
            try {
                const itemRegex = /<div[^>]*class="[^"]*item[^"]*"[^>]*>(.*?)<\/div>/gs;
                let itemMatch;
                
                while ((itemMatch = itemRegex.exec(html)) !== null) {
                    if (itemMatch[1]) {
                        const linkRegex = /<a[^>]*href="(\/p\/[^"]*)"[^>]*>([^<]*)<\/a>/;
                        const linkMatch = linkRegex.exec(itemMatch[1]);
                        
                        if (linkMatch && linkMatch[1] && linkMatch[2]) {
                            const title = linkMatch[2].trim();
                            const url = `https://www.xiaolipan.com${linkMatch[1]}`;
                            
                            if (title && title.length > 5 && !isNavigationElement(title)) {
                                const relevance = calculateRelevance(title, query, author);
                                if (relevance > 10) {
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
                }
            } catch (error) {
                console.error("项目解析失败:", error);
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
        console.log(`小立盘找到 ${uniqueBooks.length} 个相关书籍`);
        return uniqueBooks.slice(0, 5);
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return [];
    }
}

// Book5678爬虫
async function scrapeBook5678(query, isbn, author) {
    try {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://book5678.com/search.php?q=${encodedQuery}`;
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
        
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`Book5678搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用正则表达式匹配
        try {
            const regex = /<a[^>]*href="(\/post\/[^"]*)"[^>]*>([^<]*)<\/a>/g;
            let match;
            
            while ((match = regex.exec(html)) !== null) {
                if (match[1] && match[2]) {
                    const title = match[2].trim();
                    const url = `https://book5678.com${match[1]}`;
                    
                    if (title && title.length > 5 && !isNavigationElement(title)) {
                        const relevance = calculateRelevance(title, query, author);
                        if (relevance > 10) {
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
        } catch (error) {
            console.error("正则表达式解析失败:", error);
        }
        
        // 尝试查找包含特定类的元素
        if (bookDetails.length === 0) {
            try {
                const itemRegex = /<div[^>]*class="[^"]*item[^"]*"[^>]*>(.*?)<\/div>/gs;
                let itemMatch;
                
                while ((itemMatch = itemRegex.exec(html)) !== null) {
                    if (itemMatch[1]) {
                        const linkRegex = /<a[^>]*href="(\/post\/[^"]*)"[^>]*>([^<]*)<\/a>/;
                        const linkMatch = linkRegex.exec(itemMatch[1]);
                        
                        if (linkMatch && linkMatch[1] && linkMatch[2]) {
                            const title = linkMatch[2].trim();
                            const url = `https://book5678.com${linkMatch[1]}`;
                            
                            if (title && title.length > 5 && !isNavigationElement(title)) {
                                const relevance = calculateRelevance(title, query, author);
                                if (relevance > 10) {
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
                }
            } catch (error) {
                console.error("项目解析失败:", error);
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
        console.log(`Book5678找到 ${uniqueBooks.length} 个相关书籍`);
        return uniqueBooks.slice(0, 5);
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return [];
    }
}

// 35PPT爬虫
async function scrape35PPT(query, isbn, author) {
    try {
        const encodedQuery = encodeURIComponent(query);
        const searchUrl = `https://www.35ppt.com/?s=${encodedQuery}`;
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
        
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`35PPT搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        const bookDetails = [];
        
        // 使用正则表达式匹配
        try {
            const regex = /<a[^>]*href="(\/\d+\.html)"[^>]*>([^<]*)<\/a>/g;
            let match;
            
            while ((match = regex.exec(html)) !== null) {
                if (match[1] && match[2]) {
                    const title = match[2].trim();
                    const url = `https://www.35ppt.com${match[1]}`;
                    const idMatch = url.match(/\/(\d+)\.html$/);
                    
                    if (title && title.length > 5 && !isNavigationElement(title) && idMatch && idMatch[1]) {
                        const relevance = calculateRelevance(title, query, author);
                        if (relevance > 10) {
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
        } catch (error) {
            console.error("正则表达式解析失败:", error);
        }
        
        // 尝试查找文章元素
        if (bookDetails.length === 0) {
            try {
                const articleRegex = /<article[^>]*>(.*?)<\/article>/gs;
                let articleMatch;
                
                while ((articleMatch = articleRegex.exec(html)) !== null) {
                    if (articleMatch[1]) {
                        const linkRegex = /<a[^>]*href="(\/\d+\.html)"[^>]*>([^<]*)<\/a>/;
                        const linkMatch = linkRegex.exec(articleMatch[1]);
                        
                        if (linkMatch && linkMatch[1] && linkMatch[2]) {
                            const title = linkMatch[2].trim();
                            const url = `https://www.35ppt.com${linkMatch[1]}`;
                            const idMatch = url.match(/\/(\d+)\.html$/);
                            
                            if (title && title.length > 5 && !isNavigationElement(title) && idMatch && idMatch[1]) {
                                const relevance = calculateRelevance(title, query, author);
                                if (relevance > 10) {
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
                }
            } catch (error) {
                console.error("文章解析失败:", error);
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
        console.log(`35PPT找到 ${uniqueBooks.length} 个相关书籍`);
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
        if (word.length > 1) {
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
            
            results = [...results, ...wordResults];
            await new Promise(resolve => setTimeout(resolve, 800));
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

// 关键词组合搜索策略
async function keywordCombinationSearch(target, query, isbn, author) {
    console.log(`使用关键词组合搜索策略: ${target} - ${query}`);
    
    const extractedKeywords = extractKeywordsFromQuery(query);
    console.log(`从查询中提取的关键词: ${extractedKeywords.join(', ')}`);
    
    let results = [];
    
    for (const keyword of extractedKeywords) {
        let keywordResults = [];
        
        switch (target) {
            case 'xiaolipan':
                keywordResults = await scrapeXiaolipan(keyword, isbn, author);
                break;
            case 'book5678':
                keywordResults = await scrapeBook5678(keyword, isbn, author);
                break;
            case '35ppt':
                keywordResults = await scrape35PPT(keyword, isbn, author);
                break;
        }
        
        results = [...results, ...keywordResults];
        await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // 如果仍然没有结果，尝试使用原始查询的简化版本
    if (results.length === 0) {
        const simplifiedQuery = simplifyQuery(query);
        console.log(`尝试简化查询: ${simplifiedQuery}`);
        
        let simplifiedResults = [];
        
        switch (target) {
            case 'xiaolipan':
                simplifiedResults = await scrapeXiaolipan(simplifiedQuery, isbn, author);
                break;
            case 'book5678':
                simplifiedResults = await scrapeBook5678(simplifiedQuery, isbn, author);
                break;
            case '35ppt':
                simplifiedResults = await scrape35PPT(simplifiedQuery, isbn, author);
                break;
        }
        
        results = [...results, ...simplifiedResults];
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

// 从查询中提取关键词
function extractKeywordsFromQuery(query) {
    const stopWords = new Set([
        '我想', '了解', '学习', '阅读', '关于', '的', '和', '与', '及', '以及',
        '一些', '各种', '多种', '不同', '相关', '方面', '领域', '知识',
        '我', '你', '他', '她', '它', '我们', '你们', '他们',
        '是', '有', '在', '这', '那', '哪些', '什么', '如何', '为什么',
        '一个', '一种', '一本', '一部', '一套', '一系列'
    ]);
    
    const words = query.split(/[\s\u3000\u200b]+/).filter(word => 
        word.length > 1 && !stopWords.has(word)
    );
    
    if (words.length < 2) {
        const chars = query.split('').filter(char => 
            char.trim() && !stopWords.has(char) && char !== ' ' && char !== '\u3000'
        );
        
        const combinedWords = [];
        for (let i = 0; i < chars.length - 1; i++) {
            combinedWords.push(chars[i] + chars[i + 1]);
        }
        
        return Array.from(new Set(combinedWords)).slice(0, 5);
    }
    
    return Array.from(new Set(words)).slice(0, 5);
}

// 简化查询
function simplifyQuery(query) {
    const simplified = query
        .replace(/(我想|了解|学习|阅读|关于|的|和|与|及|以及|一些|各种|多种|不同|相关|方面|领域|知识)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    return simplified || query;
}

// 检查是否是导航元素
function isNavigationElement(title) {
    const lowerTitle = title.toLowerCase();
    const navigationTerms = [
        "首页", "关于我们", "联系我们", "登录", "注册", "搜索",
        "home", "about", "contact", "login", "signup", "search",
        "小立盘", "book5678", "35ppt", "网站", "导航", "菜单"
    ];
    
    return navigationTerms.some(term => lowerTitle.includes(term.toLowerCase()));
}

// 智能相关性计算函数
function calculateRelevance(title, query, author) {
    let score = 0;
    
    const lowerTitle = title.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const lowerAuthor = author ? author.toLowerCase() : '';
    
    if (lowerTitle.includes(lowerQuery)) {
        score += 50;
    }
    
    const queryWords = lowerQuery.split(/\s+/);
    let matchedWords = 0;
    
    for (const word of queryWords) {
        if (word.length > 1 && lowerTitle.includes(word)) {
            matchedWords++;
            score += 15;
        }
    }
    
    if (lowerAuthor && lowerTitle.includes(lowerAuthor)) {
        score += 30;
    }
    
    if (lowerTitle === lowerQuery) {
        score += 100;
    }
    
    if (lowerTitle.includes("曾国藩")) {
        score += 40;
    }
    
    if (lowerTitle.includes("晚清")) {
        score += 20;
    }
    
    if (lowerTitle.includes("中兴")) {
        score += 20;
    }
    
    if (title.length < 5) {
        score -= 50;
    }
    
    if (isNavigationElement(title)) {
        score -= 100;
    }
    
    return Math.max(0, score);
}
