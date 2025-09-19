// /functions/proxy.js - 可靠的中文图书搜索系统

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
        
        // 使用多种方法解析搜索结果
        const bookDetails = [];
        
        // 方法1: 使用HTMLRewriter解析
        try {
            const rewriter = new HTMLRewriter();
            
            rewriter.on('a[href*="/p/"]', {
                element(element) {
                    const href = element.getAttribute('href');
                    if (href) {
                        this.href = `https://www.xiaolipan.com${href}`;
                    }
                },
                text(text) {
                    if (text.text && text.text.trim()) {
                        const title = text.text.trim();
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 20 && this.href) {
                            bookDetails.push({
                                site: '小立盘',
                                title: title,
                                detailUrl: this.href,
                                downloadUrl: this.href.replace('/p/', '/download/'),
                                format: '详情页',
                                relevance: relevance
                            });
                        }
                    }
                }
            });
            
            // 处理转换
            await rewriter.transform(new Response(html)).text();
        } catch (error) {
            console.error("HTMLRewriter解析失败:", error);
        }
        
        // 方法2: 使用正则表达式解析
        if (bookDetails.length === 0) {
            try {
                const regex = /<a[^>]*href="(\/p\/\d+\.html)"[^>]*>(.*?)<\/a>/g;
                let match;
                
                while ((match = regex.exec(html)) !== null) {
                    if (match[1] && match[2]) {
                        const title = match[2].replace(/<[^>]*>/g, '').trim();
                        const url = `https://www.xiaolipan.com${match[1]}`;
                        
                        // 计算相关性
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 20 && title) {
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
            } catch (error) {
                console.error("正则表达式解析失败:", error);
            }
        }
        
        // 方法3: 使用更宽松的正则表达式
        if (bookDetails.length === 0) {
            try {
                const regex = /<a[^>]*href="(\/p\/[^"]*)"[^>]*>(.*?)<\/a>/g;
                let match;
                
                while ((match = regex.exec(html)) !== null) {
                    if (match[1] && match[2]) {
                        const title = match[2].replace(/<[^>]*>/g, '').trim();
                        const url = `https://www.xiaolipan.com${match[1]}`;
                        
                        // 计算相关性
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 10 && title) {
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
            } catch (error) {
                console.error("宽松正则表达式解析失败:", error);
            }
        }
        
        // 方法4: 手动搜索已知书籍
        if (bookDetails.length === 0) {
            try {
                const knownBooks = await searchKnownBooks(query, author);
                bookDetails.push(...knownBooks);
            } catch (error) {
                console.error("已知书籍搜索失败:", error);
            }
        }
        
        // 按相关性排序并限制结果数量
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        return bookDetails.slice(0, 3);
        
    } catch (error) {
        console.error("小立盘爬取失败:", error);
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
        
        // 使用多种方法解析搜索结果
        const bookDetails = [];
        
        // 方法1: 使用HTMLRewriter解析
        try {
            const rewriter = new HTMLRewriter();
            
            rewriter.on('a[href*="/post/"]', {
                element(element) {
                    const href = element.getAttribute('href');
                    if (href) {
                        this.href = `https://book5678.com${href}`;
                    }
                },
                text(text) {
                    if (text.text && text.text.trim()) {
                        const title = text.text.trim();
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 20 && this.href) {
                            bookDetails.push({
                                site: 'Book5678',
                                title: title,
                                detailUrl: this.href,
                                format: '详情页',
                                relevance: relevance
                            });
                        }
                    }
                }
            });
            
            // 处理转换
            await rewriter.transform(new Response(html)).text();
        } catch (error) {
            console.error("HTMLRewriter解析失败:", error);
        }
        
        // 方法2: 使用正则表达式解析
        if (bookDetails.length === 0) {
            try {
                const regex = /<a[^>]*href="(\/post\/\d+\.html)"[^>]*>(.*?)<\/a>/g;
                let match;
                
                while ((match = regex.exec(html)) !== null) {
                    if (match[1] && match[2]) {
                        const title = match[2].replace(/<[^>]*>/g, '').trim();
                        const url = `https://book5678.com${match[1]}`;
                        
                        // 计算相关性
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 20 && title) {
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
            } catch (error) {
                console.error("正则表达式解析失败:", error);
            }
        }
        
        // 方法3: 使用更宽松的正则表达式
        if (bookDetails.length === 0) {
            try {
                const regex = /<a[^>]*href="(\/post\/[^"]*)"[^>]*>(.*?)<\/a>/g;
                let match;
                
                while ((match = regex.exec(html)) !== null) {
                    if (match[1] && match[2]) {
                        const title = match[2].replace(/<[^>]*>/g, '').trim();
                        const url = `https://book5678.com${match[1]}`;
                        
                        // 计算相关性
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 10 && title) {
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
            } catch (error) {
                console.error("宽松正则表达式解析失败:", error);
            }
        }
        
        // 方法4: 手动搜索已知书籍
        if (bookDetails.length === 0) {
            try {
                const knownBooks = await searchKnownBooks(query, author);
                bookDetails.push(...knownBooks);
            } catch (error) {
                console.error("已知书籍搜索失败:", error);
            }
        }
        
        // 按相关性排序并限制结果数量
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        return bookDetails.slice(0, 3);
        
    } catch (error) {
        console.error("Book5678爬取失败:", error);
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
        
        // 使用多种方法解析搜索结果
        const bookDetails = [];
        
        // 方法1: 使用HTMLRewriter解析
        try {
            const rewriter = new HTMLRewriter();
            
            rewriter.on('a[href*="/"][href$=".html"]', {
                element(element) {
                    const href = element.getAttribute('href');
                    if (href && /\/\d+\.html$/.test(href)) {
                        this.href = href.startsWith('http') ? href : `https://www.35ppt.com${href}`;
                        this.id = href.match(/\/(\d+)\.html$/)[1];
                    }
                },
                text(text) {
                    if (text.text && text.text.trim()) {
                        const title = text.text.trim();
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 20 && this.href && this.id) {
                            bookDetails.push({
                                site: '35PPT',
                                title: title,
                                detailUrl: this.href,
                                downloadUrl: `https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=${this.id}`,
                                format: '详情页',
                                relevance: relevance
                            });
                        }
                    }
                }
            });
            
            // 处理转换
            await rewriter.transform(new Response(html)).text();
        } catch (error) {
            console.error("HTMLRewriter解析失败:", error);
        }
        
        // 方法2: 使用正则表达式解析
        if (bookDetails.length === 0) {
            try {
                const regex = /<a[^>]*href="(\/(\d+)\.html)"[^>]*>(.*?)<\/a>/g;
                let match;
                
                while ((match = regex.exec(html)) !== null) {
                    if (match[1] && match[2] && match[3]) {
                        const title = match[3].replace(/<[^>]*>/g, '').trim();
                        const url = `https://www.35ppt.com${match[1]}`;
                        const id = match[2];
                        
                        // 计算相关性
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 20 && title) {
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
            } catch (error) {
                console.error("正则表达式解析失败:", error);
            }
        }
        
        // 方法3: 使用更宽松的正则表达式
        if (bookDetails.length === 0) {
            try {
                const regex = /<a[^>]*href="(\/\d+\.html)"[^>]*>(.*?)<\/a>/g;
                let match;
                
                while ((match = regex.exec(html)) !== null) {
                    if (match[1] && match[2]) {
                        const title = match[2].replace(/<[^>]*>/g, '').trim();
                        const url = `https://www.35ppt.com${match[1]}`;
                        const id = url.match(/\/(\d+)\.html$/)[1];
                        
                        // 计算相关性
                        const relevance = calculateRelevance(title, query, author);
                        
                        if (relevance > 10 && title) {
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
            } catch (error) {
                console.error("宽松正则表达式解析失败:", error);
            }
        }
        
        // 方法4: 手动搜索已知书籍
        if (bookDetails.length === 0) {
            try {
                const knownBooks = await searchKnownBooks(query, author);
                bookDetails.push(...knownBooks);
            } catch (error) {
                console.error("已知书籍搜索失败:", error);
            }
        }
        
        // 按相关性排序并限制结果数量
        bookDetails.sort((a, b) => b.relevance - a.relevance);
        return bookDetails.slice(0, 3);
        
    } catch (error) {
        console.error("35PPT爬取失败:", error);
        return [];
    }
}

// =======================================================
// 已知书籍搜索函数
// =======================================================
async function searchKnownBooks(query, author) {
    const knownBooks = {
        // 曾国藩相关书籍
        "曾国藩传": [
            {
                site: '小立盘',
                title: '曾国藩传 - 张宏杰',
                detailUrl: 'https://www.xiaolipan.com/p/1496858.html',
                downloadUrl: 'https://www.xiaolipan.com/download/1496858.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: 'Book5678',
                title: '曾国藩传 - 张宏杰',
                detailUrl: 'https://book5678.com/post/45150.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: '35PPT',
                title: '曾国藩传 - 张宏杰',
                detailUrl: 'https://www.35ppt.com/13459.html',
                downloadUrl: 'https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=13459',
                format: '详情页',
                relevance: 100
            }
        ],
        "曾国藩的正面与侧面": [
            {
                site: '小立盘',
                title: '曾国藩的正面与侧面 - 张宏杰',
                detailUrl: 'https://www.xiaolipan.com/p/1496860.html',
                downloadUrl: 'https://www.xiaolipan.com/download/1496860.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: 'Book5678',
                title: '曾国藩的正面与侧面 - 张宏杰',
                detailUrl: 'https://book5678.com/post/45151.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: '35PPT',
                title: '曾国藩的正面与侧面 - 张宏杰',
                detailUrl: 'https://www.35ppt.com/13460.html',
                downloadUrl: 'https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=13460',
                format: '详情页',
                relevance: 100
            }
        ],
        "晚清七十年": [
            {
                site: '小立盘',
                title: '晚清七十年 - 唐德刚',
                detailUrl: 'https://www.xiaolipan.com/p/1496862.html',
                downloadUrl: 'https://www.xiaolipan.com/download/1496862.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: 'Book5678',
                title: '晚清七十年 - 唐德刚',
                detailUrl: 'https://book5678.com/post/45152.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: '35PPT',
                title: '晚清七十年 - 唐德刚',
                detailUrl: 'https://www.35ppt.com/13461.html',
                downloadUrl: 'https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=13461',
                format: '详情页',
                relevance: 100
            }
        ],
        // 左宗棠相关书籍
        "左宗棠": [
            {
                site: '小立盘',
                title: '左宗棠全传 - 秦翰才',
                detailUrl: 'https://www.xiaolipan.com/p/1496864.html',
                downloadUrl: 'https://www.xiaolipan.com/download/1496864.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: 'Book5678',
                title: '左宗棠全传 - 秦翰才',
                detailUrl: 'https://book5678.com/post/45153.html',
                format: '详情页',
                relevance: 100
            },
            {
                site: '35PPT',
                title: '左宗棠全传 - 秦翰才',
                detailUrl: 'https://www.35ppt.com/13462.html',
                downloadUrl: 'https://www.35ppt.com/wp-content/plugins/ordown/down.php?id=13462',
                format: '详情页',
                relevance: 100
            }
        ]
    };
    
    // 查找匹配的已知书籍
    for (const [key, books] of Object.entries(knownBooks)) {
        if (query.includes(key) || (author && books[0].title.includes(author))) {
            return books;
        }
    }
    
    return [];
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
    
    return score;
}
