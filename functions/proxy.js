// /functions/proxy.js - 智能中文图书搜索系统

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
    const bookLinks = [];
    
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
        
        // 使用更精确的解析方法
        const bookDetails = await parseXiaolipanSearchResults(html, query, author);
        
        if (bookDetails.length === 0) {
            console.log("小立盘未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`小立盘找到 ${bookDetails.length} 个匹配的书籍`);
        
        return bookDetails;
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
        return bookLinks;
    }
}

// 解析小立盘搜索结果
async function parseXiaolipanSearchResults(html, query, author) {
    const bookDetails = [];
    
    try {
        // 使用HTMLRewriter解析HTML
        const rewriter = new HTMLRewriter();
        
        rewriter.on('div.book-item', {
            element(element) {
                this.bookItem = {
                    title: '',
                    url: '',
                    author: ''
                };
            },
            text(text) {
                if (text.text.includes('《') && text.text.includes('》')) {
                    this.bookItem.title = text.text.trim();
                } else if (text.text.includes('作者：')) {
                    this.bookItem.author = text.text.replace('作者：', '').trim();
                }
            }
        });
        
        rewriter.on('div.book-item a', {
            element(element) {
                const href = element.getAttribute('href');
                if (href && href.includes('/p/')) {
                    this.bookItem.url = `https://www.xiaolipan.com${href}`;
                }
            }
        });
        
        // 处理转换
        await rewriter.transform(new Response(html)).text();
        
        // 如果没有找到书籍，尝试备用解析方法
        if (bookDetails.length === 0) {
            // 使用正则表达式作为备选方案
            const regex = /<a[^>]*href="(\/p\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/g;
            let match;
            
            while ((match = regex.exec(html)) !== null) {
                if (match[1] && match[2]) {
                    const title = match[2].trim();
                    const url = `https://www.xiaolipan.com${match[1]}`;
                    
                    // 计算相关性
                    const relevance = calculateRelevance(title, query, author);
                    
                    if (relevance > 30) { // 设置相关性阈值
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
        
        // 按相关性排序
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        
        return bookDetails.slice(0, 3); // 返回最多3个结果
        
    } catch (error) {
        console.error("解析小立盘搜索结果失败:", error);
        return [];
    }
}

// =======================================================
// Book5678 (book5678.com) 爬取函数
// =======================================================
async function scrapeBook5678(query, isbn, author) {
    const bookLinks = [];
    
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
        
        // 解析搜索结果
        const bookDetails = parseBook5678SearchResults(html, query, author);
        
        if (bookDetails.length === 0) {
            console.log("Book5678未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`Book5678找到 ${bookDetails.length} 个匹配的书籍`);
        
        return bookDetails;
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return bookLinks;
    }
}

// 解析Book5678搜索结果
function parseBook5678SearchResults(html, query, author) {
    const bookDetails = [];
    
    try {
        // 使用正则表达式解析搜索结果
        const regex = /<a[^>]*href="(\/post\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/g;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2]) {
                const title = match[2].trim();
                const url = `https://book5678.com${match[1]}`;
                
                // 计算相关性
                const relevance = calculateRelevance(title, query, author);
                
                if (relevance > 30) { // 设置相关性阈值
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
        
        // 按相关性排序
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        
        return bookDetails.slice(0, 3); // 返回最多3个结果
        
    } catch (error) {
        console.error("解析Book5678搜索结果失败:", error);
        return [];
    }
}

// =======================================================
// 35PPT (35ppt.com) 爬取函数
// =======================================================
async function scrape35PPT(query, isbn, author) {
    const bookLinks = [];
    
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
        
        // 解析搜索结果
        const bookDetails = parse35PPTSearchResults(html, query, author);
        
        if (bookDetails.length === 0) {
            console.log("35PPT未找到匹配的书籍");
            return bookLinks;
        }
        
        console.log(`35PPT找到 ${bookDetails.length} 个匹配的书籍`);
        
        return bookDetails;
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return bookLinks;
    }
}

// 解析35PPT搜索结果
function parse35PPTSearchResults(html, query, author) {
    const bookDetails = [];
    
    try {
        // 使用正则表达式解析搜索结果
        const regex = /<a[^>]*href="(\/(\d+)\.html)"[^>]*title="([^"]*)"[^>]*>/g;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2] && match[3]) {
                const title = match[3].trim();
                const url = `https://www.35ppt.com${match[1]}`;
                const id = match[2];
                
                // 计算相关性
                const relevance = calculateRelevance(title, query, author);
                
                if (relevance > 30) { // 设置相关性阈值
                    bookDetails.push({
                        site: '35PPT',
                        title: title,
                        detailUrl: url,
                        downloadUrl: `https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=${id}`,
                        format: '详情页',
                        relevance: relevance
                    });
                }
            }
        }
        
        // 按相关性排序
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        
        return bookDetails.slice(0, 3); // 返回最多3个结果
        
    } catch (error) {
        console.error("解析35PPT搜索结果失败:", error);
        return [];
    }
}

// =======================================================
// 智能相关性计算函数
// =======================================================

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
    
    // 5. 检查是否是知名书籍的变体
    const knownBooks = {
        "曾国藩传": ["曾国藩传", "曾国藩全传", "曾国藩传记", "曾文正公传"],
        "曾国藩的正面与侧面": ["曾国藩的正面与侧面", "曾国藩正面与侧面"],
        "晚清七十年": ["晚清七十年", "晚清70年"],
        "左宗棠": ["左宗棠", "左文襄公", "左季高"],
        "左宗棠全传": ["左宗棠全传", "左宗棠传", "左宗棠传记"]
    };
    
    for (const [knownTitle, variants] of Object.entries(knownBooks)) {
        if (variants.some(variant => lowerTitle.includes(variant.toLowerCase()))) {
            score += 40;
            break;
        }
    }
    
    return score;
}
