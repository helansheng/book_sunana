// /functions/proxy.js - 直接处理ManyBooks爬取，不依赖第三方API

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
// 直接处理ManyBooks爬取的函数
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
        
        // 第二步: 访问详情页并处理可能的验证
        const downloadLinks = await getDownloadLinks(bookDetailUrl);
        
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
    const regexPatterns = [
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*class="[^"]*book-title[^"]*"[^>]*>/i,
        /<a[^>]*href="(\/book\/[^"]*)"[^>]*title="[^"]*"[^>]*>/i,
        /<h3[^>]*>\s*<a[^>]*href="(\/book\/[^"]*)"[^>]*>/i
    ];
    
    for (const pattern of regexPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            return new URL(match[1], 'https://manybooks.net').href;
        }
    }
    
    // 方法2: 使用HTMLRewriter作为备选
    let foundUrl = null;
    const rewriter = new HTMLRewriter();
    rewriter.on('a[href*="/book/"]', {
        element(element) {
            if (!foundUrl) {
                const href = element.getAttribute('href');
                const text = element.text;
                
                // 检查链接文本是否与查询相关
                if (href && text && isRelevantResult(text, query)) {
                    foundUrl = new URL(href, 'https://manybooks.net').href;
                }
            }
        }
    });
    
    // 消耗响应体来触发解析
    rewriter.transform(new Response(html)).text();
    
    return foundUrl;
}

// =======================================================
// 获取下载链接（处理验证流程）
// =======================================================
async function getDownloadLinks(bookUrl) {
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
        // 第一次访问详情页
        let response = await fetch(bookUrl, { headers });
        
        if (!response.ok) {
            throw new Error(`详情页请求失败: ${response.status}`);
        }
        
        let html = await response.text();
        
        // 检查是否需要验证
        if (requiresVerification(html)) {
            console.log("检测到需要验证，尝试处理验证流程");
            
            // 提取验证表单数据
            const verificationData = extractVerificationData(html);
            
            if (verificationData) {
                // 提交验证表单
                const formResponse = await submitVerification(verificationData, headers);
                
                if (formResponse.ok) {
                    html = await formResponse.text();
                } else {
                    console.error("验证表单提交失败");
                }
            }
        }
        
        // 解析下载链接
        return parseDownloadLinksFromHtml(html);
        
    } catch (error) {
        console.error("获取下载链接失败:", error);
        return [];
    }
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
// 提取验证表单数据
// =======================================================
function extractVerificationData(html) {
    // 查找表单
    const formRegex = /<form[^>]*action="([^"]*)"[^>]*method="([^"]*)"[^>]*>([\s\S]*?)<\/form>/i;
    const formMatch = html.match(formRegex);
    
    if (!formMatch) {
        return null;
    }
    
    const action = formMatch[1];
    const method = formMatch[2] || 'POST';
    const formContent = formMatch[3];
    
    // 提取所有隐藏字段
    const fieldRegex = /<input[^>]*type="hidden"[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi;
    const fields = {};
    let fieldMatch;
    
    while ((fieldMatch = fieldRegex.exec(formContent)) !== null) {
        fields[fieldMatch[1]] = fieldMatch[2];
    }
    
    // 提取提交按钮（如果需要）
    const submitRegex = /<input[^>]*type="submit"[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/i;
    const submitMatch = formContent.match(submitRegex);
    if (submitMatch) {
        fields[submitMatch[1]] = submitMatch[2];
    }
    
    return {
        action: action.startsWith('http') ? action : new URL(action, 'https://manybooks.net').href,
        method: method,
        fields: fields
    };
}

// =======================================================
// 提交验证表单
// =======================================================
async function submitVerification(verificationData, headers) {
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(verificationData.fields)) {
        formData.append(key, value);
    }
    
    const requestOptions = {
        method: verificationData.method,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...headers
        },
        body: formData.toString()
    };
    
    return await fetch(verificationData.action, requestOptions);
}

// =======================================================
// 从HTML解析下载链接
// =======================================================
function parseDownloadLinksFromHtml(html) {
    const downloadLinks = [];
    
    // 方法1: 使用正则表达式查找下载链接
    const downloadRegex = /<a[^>]*href="(\/download\/[^"]*)"[^>]*>([^<]*)<\/a>/gi;
    let downloadMatch;
    
    while ((downloadMatch = downloadRegex.exec(html)) !== null) {
        const format = downloadMatch[2].trim();
        const url = downloadMatch[1];
        
        if (format && url) {
            downloadLinks.push({
                format: format.toUpperCase(),
                url: new URL(url, 'https://manybooks.net').href
            });
        }
    }
    
    // 方法2: 如果正则没找到，尝试HTMLRewriter
    if (downloadLinks.length === 0) {
        const rewriter = new HTMLRewriter();
        rewriter.on('a[href*="/download/"]', {
            element(element) {
                const href = element.getAttribute('href');
                const text = element.text;
                if (href && text) {
                    downloadLinks.push({
                        format: text.trim().toUpperCase(),
                        url: new URL(href, 'https://manybooks.net').href
                    });
                }
            }
        });
        
        // 消耗响应体来触发解析
        rewriter.transform(new Response(html)).text();
    }
    
    return downloadLinks;
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
