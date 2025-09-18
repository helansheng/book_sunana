// /functions/proxy.js - 直接爬取 ManyBooks 官方页面的解决方案

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

        // 处理 ManyBooks 爬取任务
        if (scrapeTask && scrapeTask.target === 'manybooks') {
            return handleManyBooksScraper(scrapeTask.query, scrapeTask.isbn);
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
// 直接处理ManyBooks官方页面爬取的函数
// =======================================================
async function handleManyBooksScraper(query, isbn) {
    try {
        console.log(`开始ManyBooks搜索: ${query}, ISBN: ${isbn}`);
        
        // 第一步: 搜索书籍获取详情页URL
        const bookDetailUrl = await searchManyBooks(query, isbn);
        
        if (!bookDetailUrl) {
            console.log("未找到匹配的书籍");
            return new Response(JSON.stringify([]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        
        console.log(`找到书籍详情页: ${bookDetailUrl}`);
        
        // 第二步: 访问详情页并获取下载链接
        const downloadLinks = await getDownloadLinksFromDetailPage(bookDetailUrl);
        
        console.log(`获取到 ${downloadLinks.length} 个下载链接`);
        
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
// 搜索ManyBooks获取书籍详情页URL
// =======================================================
async function searchManyBooks(query, isbn) {
    // 构建搜索URL - 优先使用ISBN搜索（如果提供）
    let searchUrl;
    if (isbn && isbn !== 'null' && isbn !== 'undefined') {
        searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(isbn)}`;
    } else {
        // 对于中文书籍，添加"中文"关键词提高匹配度
        const enhancedQuery = hasChineseCharacters(query) ? `${query} 中文` : query;
        searchUrl = `https://manybooks.net/search-book?search=${encodeURIComponent(enhancedQuery)}`;
    }
    
    console.log(`搜索URL: ${searchUrl}`);
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://manybooks.net/',
    };
    
    try {
        const response = await fetch(searchUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`搜索请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 解析搜索结果，获取第一个匹配的书籍详情页URL
        return parseSearchResults(html, query);
        
    } catch (error) {
        console.error("搜索失败:", error);
        return null;
    }
}

// =======================================================
// 解析搜索结果获取书籍详情页URL
// =======================================================
function parseSearchResults(html, query) {
    // 方法1: 使用正则表达式查找详情页链接
    // ManyBooks的搜索结果页通常使用这种格式的链接
    const regexPatterns = [
        /<a[^>]*href="(\/titles\/[^"]*)"[^>]*class="[^"]*book-title[^"]*"[^>]*>/i,
        /<a[^>]*href="(\/titles\/[^"]*)"[^>]*title="[^"]*"[^>]*>/i,
        /<h2[^>]*>\s*<a[^>]*href="(\/titles\/[^"]*)"[^>]*>/i,
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*book-title[^"]*"[^>]*>/i
    ];
    
    for (const pattern of regexPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            const url = match[1].startsWith('http') ? match[1] : `https://manybooks.net${match[1]}`;
            console.log(`使用正则找到详情页: ${url}`);
            return url;
        }
    }
    
    // 方法2: 使用HTMLRewriter作为备选
    let foundUrl = null;
    const rewriter = new HTMLRewriter();
    rewriter.on('a[href*="/titles/"], a[href*="/book/"]', {
        element(element) {
            if (!foundUrl) {
                const href = element.getAttribute('href');
                const text = element.text;
                
                // 检查链接文本是否与查询相关
                if (href && text && isRelevantResult(text, query)) {
                    foundUrl = href.startsWith('http') ? href : `https://manybooks.net${href}`;
                    console.log(`使用HTMLRewriter找到详情页: ${foundUrl}`);
                }
            }
        }
    });
    
    // 消耗响应体来触发解析
    rewriter.transform(new Response(html)).text();
    
    return foundUrl;
}

// =======================================================
// 从详情页获取下载链接
// =======================================================
async function getDownloadLinksFromDetailPage(detailUrl) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://manybooks.net/',
    };
    
    try {
        // 访问详情页
        const response = await fetch(detailUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`详情页请求失败: ${response.status}`);
        }
        
        const html = await response.text();
        
        // 解析下载链接
        const downloadLinks = parseDownloadLinksFromDetailPage(html);
        
        // 如果没找到下载链接，尝试处理可能的验证
        if (downloadLinks.length === 0 && requiresVerification(html)) {
            console.log("检测到需要验证，尝试处理验证流程");
            const verifiedHtml = await handleVerification(detailUrl, html, headers);
            return parseDownloadLinksFromDetailPage(verifiedHtml);
        }
        
        return downloadLinks;
        
    } catch (error) {
        console.error("获取下载链接失败:", error);
        return [];
    }
}

// =======================================================
// 从详情页HTML解析下载链接
// =======================================================
function parseDownloadLinksFromDetailPage(html) {
    const downloadLinks = [];
    
    // ManyBooks详情页的下载链接通常在这些位置:
    // 1. 侧边栏的下载区域
    // 2. 页面底部的下载区域
    // 3. 专门的下载页面链接
    
    // 方法1: 查找侧边栏下载链接
    const sidebarRegex = /<div[^>]*class="[^"]*sidebar-downloads[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
    const sidebarMatch = html.match(sidebarRegex);
    
    if (sidebarMatch) {
        const sidebarHtml = sidebarMatch[1];
        const links = extractDownloadLinksFromHtml(sidebarHtml);
        downloadLinks.push(...links);
    }
    
    // 方法2: 查找底部下载链接
    const footerRegex = /<div[^>]*class="[^"]*downloads[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
    const footerMatch = html.match(footerRegex);
    
    if (footerMatch) {
        const footerHtml = footerMatch[1];
        const links = extractDownloadLinksFromHtml(footerHtml);
        downloadLinks.push(...links);
    }
    
    // 方法3: 查找所有可能的下载链接
    if (downloadLinks.length === 0) {
        const links = extractDownloadLinksFromHtml(html);
        downloadLinks.push(...links);
    }
    
    // 去重
    return Array.from(new Set(downloadLinks.map(link => JSON.stringify(link))))
        .map(str => JSON.parse(str));
}

// =======================================================
// 从HTML片段提取下载链接
// =======================================================
function extractDownloadLinksFromHtml(html) {
    const downloadLinks = [];
    
    // 查找所有下载链接
    const linkRegex = /<a[^>]*href="(\/download[^"]*)"[^>]*>([^<]*)<\/a>/gi;
    let linkMatch;
    
    while ((linkMatch = linkRegex.exec(html)) !== null) {
        const format = linkMatch[2].trim();
        const url = linkMatch[1];
        
        if (format && url && !url.includes('#')) {
            downloadLinks.push({
                format: format.toUpperCase(),
                url: `https://manybooks.net${url}`
            });
            console.log(`找到下载链接: ${format} - ${url}`);
        }
    }
    
    // 使用HTMLRewriter作为备选
    if (downloadLinks.length === 0) {
        const rewriter = new HTMLRewriter();
        rewriter.on('a[href*="/download"]', {
            element(element) {
                const href = element.getAttribute('href');
                const text = element.text;
                if (href && text) {
                    downloadLinks.push({
                        format: text.trim().toUpperCase(),
                        url: `https://manybooks.net${href}`
                    });
                }
            }
        });
        
        rewriter.transform(new Response(html)).text();
    }
    
    return downloadLinks;
}

// =======================================================
// 检查页面是否需要验证
// =======================================================
function requiresVerification(html) {
    // 检查是否存在常见的验证表单元素
    const verificationIndicators = [
        /age-verification/i,
        /download-verification/i,
        /confirm.*age/i,
        /verify.*download/i,
        /form.*action.*verify/i,
        /form.*action.*confirm/i
    ];
    
    return verificationIndicators.some(pattern => pattern.test(html));
}

// =======================================================
// 处理验证流程
// =======================================================
async function handleVerification(detailUrl, html, headers) {
    // 提取验证表单数据
    const formData = extractVerificationFormData(html);
    
    if (!formData) {
        console.log("无法提取验证表单数据");
        return html;
    }
    
    try {
        // 提交验证表单
        const formResponse = await fetch(formData.action, {
            method: formData.method,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...headers
            },
            body: formData.body
        });
        
        if (!formResponse.ok) {
            throw new Error(`验证表单提交失败: ${formResponse.status}`);
        }
        
        return await formResponse.text();
        
    } catch (error) {
        console.error("验证流程处理失败:", error);
        return html;
    }
}

// =======================================================
// 提取验证表单数据
// =======================================================
function extractVerificationFormData(html) {
    // 查找表单
    const formRegex = /<form[^>]*action="([^"]*)"[^>]*method="([^"]*)"[^>]*>([\s\S]*?)<\/form>/i;
    const formMatch = html.match(formRegex);
    
    if (!formMatch) {
        return null;
    }
    
    const action = formMatch[1];
    const method = formMatch[2] || 'POST';
    const formContent = formMatch[3];
    
    // 提取所有字段
    const fieldRegex = /<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi;
    const fields = new URLSearchParams();
    let fieldMatch;
    
    while ((fieldMatch = fieldRegex.exec(formContent)) !== null) {
        fields.append(fieldMatch[1], fieldMatch[2]);
    }
    
    return {
        action: action.startsWith('http') ? action : new URL(action, 'https://manybooks.net').href,
        method: method,
        body: fields.toString()
    };
}

// =======================================================
// 辅助函数
// =======================================================

// 检查字符串是否包含中文字符
function hasChineseCharacters(str) {
    return /[\u4e00-\u9fff]/.test(str);
}

// 检查搜索结果是否与查询相关
function isRelevantResult(resultText, query) {
    // 简单实现：检查是否有共同词汇
    const queryWords = query.toLowerCase().split(/\s+/);
    const resultWords = resultText.toLowerCase().split(/\s+/);
    
    return queryWords.some(word => 
        word.length > 2 && resultWords.some(rWord => rWord.includes(word))
    );
}
