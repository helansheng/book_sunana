// /functions/proxy.js - 完全重写的可靠爬虫
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
        
        // 如果没有找到结果，尝试使用更通用的搜索方法
        if (bookLinks.length === 0) {
            console.log(`尝试通用搜索方法: ${query}`);
            bookLinks = await generalSearch(target, query, isbn, author);
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

// 小立盘爬虫 - 使用API接口而非HTML解析
async function scrapeXiaolipan(query, isbn, author) {
    try {
        // 小立盘的实际搜索API
        const searchUrl = `https://www.xiaolipan.com/api/search?keyword=${encodeURIComponent(query)}&page=1`;
        console.log(`小立盘API搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Referer': 'https://www.xiaolipan.com/',
            'X-Requested-With': 'XMLHttpRequest'
        };
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`小立盘API请求失败: ${response.status}`);
            // 尝试备用方法
            return await fallbackXiaolipanSearch(query);
        }
        
        const data = await response.json();
        
        // 解析API响应
        const bookDetails = [];
        if (data && data.data && data.data.list) {
            data.data.list.forEach(item => {
                if (item.title && item.id) {
                    const relevance = calculateRelevance(item.title, query, author);
                    if (relevance > 10) {
                        bookDetails.push({
                            site: '小立盘',
                            title: item.title,
                            detailUrl: `https://www.xiaolipan.com/p/${item.id}.html`,
                            downloadUrl: `https://www.xiaolipan.com/download/${item.id}.html`,
                            format: '详情页',
                            relevance: relevance
                        });
                    }
                }
            });
        }
        
        return bookDetails.slice(0, 5);
        
    } catch (error) {
        console.error("小立盘API爬取失败:", error);
        // 尝试备用方法
        return await fallbackXiaolipanSearch(query);
    }
}

// 小立盘备用搜索方法
async function fallbackXiaolipanSearch(query) {
    try {
        // 尝试直接访问小立盘并模拟用户搜索
        const searchUrl = `https://www.xiaolipan.com/search.html?keyword=${encodeURIComponent(query)}`;
        console.log(`小立盘备用搜索URL: ${searchUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://www.xiaolipan.com/'
        };
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`小立盘备用搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        
        // 使用正则表达式提取书籍信息
        const bookDetails = [];
        const regex = /<a[^>]*href="(\/p\/\d+\.html)"[^>]*title="([^"]*)"[^>]*>/g;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            if (match[1] && match[2]) {
                const title = match[2].trim();
                const url = `https://www.xiaolipan.com${match[1]}`;
                
                if (title && title.length > 5) {
                    const relevance = calculateRelevance(title, query, '');
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
        
        return bookDetails.slice(0, 5);
        
    } catch (error) {
        console.error("小立盘备用搜索失败:", error);
        return [];
    }
}

// Book5678爬虫 - 使用更精确的解析方法
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
            'Referer': 'https://book5678.com/'
        };
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`Book5678搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        
        // 使用HTMLRewriter解析HTML
        const bookDetails = [];
        
        await new HTMLRewriter()
            .on('div.list-group-item', {
                element(element) {
                    this.currentItem = { href: '', title: '' };
                }
            })
            .on('div.list-group-item a[href^="/post/"]', {
                element(element) {
                    const href = element.getAttribute('href');
                    if (href) {
                        this.currentItem.href = `https://book5678.com${href}`;
                    }
                },
                text(text) {
                    if (text.text && text.lastInTextNode) {
                        this.currentItem.title = text.text.trim();
                    }
                }
            })
            .on('div.list-group-item', {
                element(element) {
                    if (this.currentItem.title && this.currentItem.href) {
                        const relevance = calculateRelevance(this.currentItem.title, query, author);
                        if (relevance > 10) {
                            bookDetails.push({
                                site: 'Book5678',
                                title: this.currentItem.title,
                                detailUrl: this.currentItem.href,
                                format: '详情页',
                                relevance: relevance
                            });
                        }
                    }
                }
            })
            .transform(new Response(html))
            .text();
        
        return bookDetails.slice(0, 5);
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
        return [];
    }
}

// 35PPT爬虫 - 使用更精确的解析方法
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
            'Referer': 'https://www.35ppt.com/'
        };
        
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            console.error(`35PPT搜索请求失败: ${response.status}`);
            return [];
        }
        
        const html = await response.text();
        
        // 使用HTMLRewriter解析HTML
        const bookDetails = [];
        
        await new HTMLRewriter()
            .on('article', {
                element(element) {
                    this.currentItem = { href: '', title: '' };
                }
            })
            .on('article h2 a', {
                element(element) {
                    const href = element.getAttribute('href');
                    if (href) {
                        this.currentItem.href = href;
                    }
                },
                text(text) {
                    if (text.text && text.lastInTextNode) {
                        this.currentItem.title = text.text.trim();
                    }
                }
            })
            .on('article', {
                element(element) {
                    if (this.currentItem.title && this.currentItem.href) {
                        const idMatch = this.currentItem.href.match(/\/(\d+)\.html$/);
                        if (idMatch && idMatch[1]) {
                            const relevance = calculateRelevance(this.currentItem.title, query, author);
                            if (relevance > 10) {
                                bookDetails.push({
                                    site: '35PPT',
                                    title: this.currentItem.title,
                                    detailUrl: this.currentItem.href,
                                    downloadUrl: `https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=${idMatch[1]}`,
                                    format: '详情页',
                                    relevance: relevance
                                });
                            }
                        }
                    }
                }
            })
            .transform(new Response(html))
            .text();
        
        return bookDetails.slice(0, 5);
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return [];
    }
}

// 通用搜索方法
async function generalSearch(target, query, isbn, author) {
    console.log(`使用通用搜索方法: ${target} - ${query}`);
    
    // 提取关键词
    const keywords = extractKeywords(query);
    let results = [];
    
    // 尝试使用每个关键词进行搜索
    for (const keyword of keywords) {
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
        
        // 添加延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));
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
function extractKeywords(query) {
    // 移除常见停用词
    const stopWords = new Set([
        '我想', '了解', '学习', '阅读', '关于', '的', '和', '与', '及', '以及',
        '一些', '各种', '多种', '不同', '相关', '方面', '领域', '知识',
        '我', '你', '他', '她', '它', '我们', '你们', '他们',
        '是', '有', '在', '这', '那', '哪些', '什么', '如何', '为什么',
        '一个', '一种', '一本', '一部', '一套', '一系列'
    ]);
    
    // 将查询分割为词语并过滤停用词
    return query.split(/[\s\u3000\u200b]+/)
        .filter(word => word.length > 1 && !stopWords.has(word))
        .slice(0, 5);
}

// 智能相关性计算函数
function calculateRelevance(title, query, author) {
    let score = 0;
    
    const lowerTitle = title.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const lowerAuthor = author ? author.toLowerCase() : '';
    
    // 检查标题是否完全包含查询词
    if (lowerTitle.includes(lowerQuery)) {
        score += 50;
    }
    
    // 检查标题是否包含查询词的主要部分
    const queryWords = lowerQuery.split(/\s+/);
    for (const word of queryWords) {
        if (word.length > 1 && lowerTitle.includes(word)) {
            score += 15;
        }
    }
    
    // 检查标题是否包含作者名
    if (lowerAuthor && lowerTitle.includes(lowerAuthor)) {
        score += 30;
    }
    
    // 检查是否是完全匹配
    if (lowerTitle === lowerQuery) {
        score += 100;
    }
    
    // 检查标题长度 - 过短的标题可能是导航元素
    if (title.length < 5) {
        score -= 50;
    }
    
    // 检查是否包含网站名称 - 排除导航元素
    if (lowerTitle.includes("小立盘") || lowerTitle.includes("book5678") || lowerTitle.includes("35ppt")) {
        score -= 100;
    }
    
    return Math.max(0, score);
}
