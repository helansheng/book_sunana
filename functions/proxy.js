// /functions/proxy.js - 终极形态：智能API代理 + 增强版ManyBooks爬虫

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
            return handleManyBooksScraper(scrapeTask.query, scrapeTask.isbn);
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
// 模式二：增强版ManyBooks爬虫函数
// =======================================================
async function handleManyBooksScraper(query, isbn) {
    try {
        // 优化搜索策略：优先使用ISBN搜索（如果提供），其次使用查询词
        let searchUrl;
        if (isbn && isbn !== 'null' && isbn !== 'undefined') {
            // 使用ISBN进行精确搜索
            searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(isbn)}`;
        } else {
            // 使用查询词进行搜索，并添加"中文"或"Chinese"提高中文书籍匹配度
            const enhancedQuery = `${query} ${query.match(/[\u4e00-\u9fff]/) ? '中文' : 'Chinese'}`;
            searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(enhancedQuery)}`;
        }
        
        console.log(`ManyBooks搜索URL: ${searchUrl}`);
        
        const headers = { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://manybooks.net/',
            'Connection': 'keep-alive'
        };

        // 第一步: 搜索书籍并获取详情页链接
        const searchResponse = await fetch(searchUrl, { headers });
        if (!searchResponse.ok) {
            throw new Error(`ManyBooks搜索失败，状态码: ${searchResponse.status}`);
        }

        const searchHtml = await searchResponse.text();
        let bookDetailUrl = null;

        // 方法1: 使用正则表达式查找详情页链接（更健壮的方法）
        const detailLinkRegex = /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*book-title[^"]*"[^>]*>/i;
        const match = searchHtml.match(detailLinkRegex);
        
        if (match && match[1]) {
            bookDetailUrl = new URL(match[1], 'https://manybooks.net').href;
            console.log(`通过正则找到详情页: ${bookDetailUrl}`);
        } else {
            // 方法2: 使用HTMLRewriter作为备选方案
            console.log("正则匹配失败，尝试HTMLRewriter...");
            await new HTMLRewriter()
                .on('a.book-title', {
                    element(element) {
                        if (!bookDetailUrl) {
                            const href = element.getAttribute('href');
                            if (href) {
                                bookDetailUrl = new URL(href, 'https://manybooks.net').href;
                                console.log(`通过HTMLRewriter找到详情页: ${bookDetailUrl}`);
                            }
                        }
                    },
                })
                .transform(new Response(searchHtml))
                .text();
        }

        if (!bookDetailUrl) {
            console.log("未找到匹配的书籍详情页");
            // 尝试更宽松的搜索策略
            return await fallbackSearchStrategy(query, isbn, headers);
        }

        // 第二步: 访问详情页并抓取下载链接
        console.log(`访问详情页: ${bookDetailUrl}`);
        const detailResponse = await fetch(bookDetailUrl, { headers });
        if (!detailResponse.ok) {
            throw new Error(`ManyBooks详情页访问失败，状态码: ${detailResponse.status}`);
        }

        const detailHtml = await detailResponse.text();
        const downloadLinks = [];

        // 方法1: 使用正则表达式提取下载链接
        const downloadRegex = /<a[^>]*href="(\/download\/[^"]*)"[^>]*class="[^"]*btn[^"]*"[^>]*>([^<]*)<\/a>/gi;
        let downloadMatch;
        
        while ((downloadMatch = downloadRegex.exec(detailHtml)) !== null) {
            const format = downloadMatch[2].trim();
            const url = downloadMatch[1];
            if (format && url) {
                downloadLinks.push({
                    format: format.toUpperCase(),
                    url: new URL(url, 'https://manybooks.net').href
                });
                console.log(`找到下载链接: ${format} - ${url}`);
            }
        }

        // 方法2: 如果正则没找到，使用HTMLRewriter作为备选
        if (downloadLinks.length === 0) {
            console.log("正则未找到下载链接，尝试HTMLRewriter...");
            await new HTMLRewriter()
                .on('a.btn', {
                    element(element) {
                        const href = element.getAttribute('href');
                        if (href && href.includes('/download/')) {
                            const format = element.getText({ text: true }).trim();
                            downloadLinks.push({
                                format: format.toUpperCase(),
                                url: new URL(href, 'https://manybooks.net').href
                            });
                            console.log(`通过HTMLRewriter找到下载链接: ${format} - ${href}`);
                        }
                    },
                })
                .transform(new Response(detailHtml))
                .text();
        }

        // 如果还是没找到，尝试查找其他可能的下载区域
        if (downloadLinks.length === 0) {
            console.log("在常规区域未找到下载链接，尝试查找其他区域...");
            await findDownloadLinksInAlternativeAreas(detailHtml, downloadLinks);
        }

        // 返回找到的下载链接数组
        return new Response(JSON.stringify(downloadLinks), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('ManyBooks Scraper Error:', error);
        return new Response(JSON.stringify({ 
            error: 'Failed to scrape ManyBooks', 
            details: error.message 
        }), { 
            status: 500, 
            headers: { 'Content-Type': 'application/json' } 
        });
    }
}

// =======================================================
// 备用搜索策略（当主搜索失败时使用）
// =======================================================
async function fallbackSearchStrategy(query, isbn, headers) {
    console.log("启用备用搜索策略...");
    
    // 策略1: 尝试英文搜索
    try {
        // 将中文标题转换为拼音或可能的英文标题
        let englishQuery = query;
        // 这里可以添加中文到英文的简单映射（针对常见书籍）
        const chineseToEnglishMap = {
            "曾国藩的正面与侧面": "Zeng Guofan",
            "活着": "To Live",
            "三体": "Three Body Problem"
            // 可以添加更多映射
        };
        
        for (const [chinese, english] of Object.entries(chineseToEnglishMap)) {
            if (query.includes(chinese)) {
                englishQuery = english;
                break;
            }
        }
        
        const searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(englishQuery)}`;
        console.log(`尝试英文搜索: ${searchUrl}`);
        
        const searchResponse = await fetch(searchUrl, { headers });
        if (!searchResponse.ok) throw new Error("英文搜索请求失败");
        
        const searchHtml = await searchResponse.text();
        const detailLinkRegex = /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*book-title[^"]*"[^>]*>/i;
        const match = searchHtml.match(detailLinkRegex);
        
        if (match && match[1]) {
            const bookDetailUrl = new URL(match[1], 'https://manybooks.net').href;
            console.log(`备用策略找到详情页: ${bookDetailUrl}`);
            
            // 访问详情页并获取下载链接（重用主函数中的逻辑）
            const detailResponse = await fetch(bookDetailUrl, { headers });
            if (!detailResponse.ok) throw new Error("详情页访问失败");
            
            const detailHtml = await detailResponse.text();
            const downloadLinks = [];
            
            // 提取下载链接
            const downloadRegex = /<a[^>]*href="(\/download\/[^"]*)"[^>]*class="[^"]*btn[^"]*"[^>]*>([^<]*)<\/a>/gi;
            let downloadMatch;
            
            while ((downloadMatch = downloadRegex.exec(detailHtml)) !== null) {
                const format = downloadMatch[2].trim();
                const url = downloadMatch[1];
                if (format && url) {
                    downloadLinks.push({
                        format: format.toUpperCase(),
                        url: new URL(url, 'https://manybooks.net').href
                    });
                }
            }
            
            if (downloadLinks.length > 0) {
                return new Response(JSON.stringify(downloadLinks), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
    } catch (error) {
        console.error("备用策略1失败:", error);
    }
    
    // 策略2: 尝试作者搜索
    try {
        // 这里可以添加从书名提取作者的逻辑
        // 例如，如果查询是"曾国藩的正面与侧面"，可以尝试搜索"曾国藩"
        const authorMatch = query.match(/(.+?)的/) || query.match(/(.+?)(?:著|编|译)/);
        if (authorMatch && authorMatch[1]) {
            const author = authorMatch[1];
            const searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(author)}`;
            console.log(`尝试作者搜索: ${searchUrl}`);
            
            const searchResponse = await fetch(searchUrl, { headers });
            if (!searchResponse.ok) throw new Error("作者搜索请求失败");
            
            const searchHtml = await searchResponse.text();
            
            // 尝试找到与原始查询最匹配的书籍
            const bookListRegex = /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*book-title[^"]*"[^>]*>([^<]*)<\/a>/gi;
            let bookMatch;
            let bestMatchUrl = null;
            let bestMatchScore = 0;
            
            while ((bookMatch = bookListRegex.exec(searchHtml)) !== null) {
                const title = bookMatch[2];
                const similarity = calculateSimilarity(query, title);
                if (similarity > bestMatchScore) {
                    bestMatchScore = similarity;
                    bestMatchUrl = bookMatch[1];
                }
            }
            
            if (bestMatchUrl && bestMatchScore > 0.3) { // 相似度阈值
                const bookDetailUrl = new URL(bestMatchUrl, 'https://manybooks.net').href;
                console.log(`作者搜索找到最匹配的书籍: ${bookDetailUrl}, 相似度: ${bestMatchScore}`);
                
                // 访问详情页并获取下载链接
                const detailResponse = await fetch(bookDetailUrl, { headers });
                if (!detailResponse.ok) throw new Error("详情页访问失败");
                
                const detailHtml = await detailResponse.text();
                const downloadLinks = [];
                
                // 提取下载链接
                const downloadRegex = /<a[^>]*href="(\/download\/[^"]*)"[^>]*class="[^"]*btn[^"]*"[^>]*>([^<]*)<\/a>/gi;
                let downloadMatch;
                
                while ((downloadMatch = downloadRegex.exec(detailHtml)) !== null) {
                    const format = downloadMatch[2].trim();
                    const url = downloadMatch[1];
                    if (format && url) {
                        downloadLinks.push({
                            format: format.toUpperCase(),
                            url: new URL(url, 'https://manybooks.net').href
                        });
                    }
                }
                
                if (downloadLinks.length > 0) {
                    return new Response(JSON.stringify(downloadLinks), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
            }
        }
    } catch (error) {
        console.error("备用策略2失败:", error);
    }
    
    // 所有策略都失败，返回空结果
    return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

// =======================================================
// 在其他区域查找下载链接
// =======================================================
async function findDownloadLinksInAlternativeAreas(html, downloadLinks) {
    // 尝试查找其他可能的下载区域
    // 1. 查找包含"download"字样的区域
    const downloadSectionRegex = /<div[^>]*class="[^"]*download[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
    const sectionMatch = html.match(downloadSectionRegex);
    
    if (sectionMatch) {
        const sectionHtml = sectionMatch[1];
        const linkRegex = /<a[^>]*href="(\/download\/[^"]*)"[^>]*>([^<]*)<\/a>/gi;
        let linkMatch;
        
        while ((linkMatch = linkRegex.exec(sectionHtml)) !== null) {
            const format = linkMatch[2].trim();
            const url = linkMatch[1];
            if (format && url) {
                downloadLinks.push({
                    format: format.toUpperCase(),
                    url: new URL(url, 'https://manybooks.net').href
                });
                console.log(`在备用区域找到下载链接: ${format} - ${url}`);
            }
        }
    }
    
    // 2. 查找所有可能的下载链接（更宽松的匹配）
    const allDownloadLinksRegex = /<a[^>]*href="(\/download[^"]*)"[^>]*>([^<]*)<\/a>/gi;
    let allMatch;
    
    while ((allMatch = allDownloadLinksRegex.exec(html)) !== null) {
        const format = allMatch[2].trim();
        const url = allMatch[1];
        // 过滤掉明显不是下载链接的URL
        if (format && url && !url.includes('#')) {
            downloadLinks.push({
                format: format.toUpperCase(),
                url: new URL(url, 'https://manybooks.net').href
            });
            console.log(`通过宽松匹配找到下载链接: ${format} - ${url}`);
        }
    }
}

// =======================================================
// 辅助函数：计算字符串相似度
// =======================================================
function calculateSimilarity(str1, str2) {
    // 简单实现：计算最长公共子序列长度与较长字符串长度的比值
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    // 检查是否包含关系
    if (longer.includes(shorter)) return shorter.length / longer.length;
    
    // 简单相似度计算（可根据需要实现更复杂的算法）
    let matchCount = 0;
    for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) matchCount++;
    }
    
    return matchCount / longer.length;
}
