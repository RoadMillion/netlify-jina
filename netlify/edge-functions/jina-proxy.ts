import { Context } from "@netlify/edge-functions";

// --- 重要提示 ---
// 请将下面的占位符替换为实际用于获取 Jina 爬取所需 Header 的 API 端点 URL。
// 这个 URL 应该返回一个包含必要 Header 的 JSON 对象。
const jinaCrawlHeaderUrl = "https://basic-crawl-param.1451871636.workers.dev";
// --- 重要提示 ---

export default async (request: Request, context: Context) => {
  // 1. 从 URL 获取查询参数
  const url = new URL(request.url);
  const originalUrl = url.searchParams.get("url");

  // 2. 验证 URL 参数是否存在
  if (!originalUrl) {
    return new Response('Missing "url" query parameter', { status: 400 });
  }

  try {
    // 3. 获取用于 Jina 代理请求的 Header
    context.log(`Fetching headers from: ${jinaCrawlHeaderUrl}`);
    const headerResponse = await fetch(jinaCrawlHeaderUrl);

    // 检查获取 Header 的请求是否成功
    if (!headerResponse.ok) {
      context.log(`Error fetching crawl headers: ${headerResponse.status} ${headerResponse.statusText}`);
      return new Response('Error fetching crawl headers: ' + headerResponse.statusText, { status: headerResponse.status });
    }

    // 4. 解析 Header 响应体为 JSON
    const headers = await headerResponse.json();
    context.log('Successfully fetched headers.');

    // 5. 构造 Jina 代理 URL
    const prefixedUrl = `https://r.jina.ai/${originalUrl}`;
    context.log('Requesting proxied URL:', prefixedUrl);

    // 6. 使用 AbortController 实现请求超时 (50 秒)
    // 注意：在 Edge Functions 中，AbortController 是全局可用的
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      context.log('Request to Jina proxy timed out after 50 seconds.');
      controller.abort();
    }, 40000); // 40 秒超时

    let proxyResponse;
    try {
      // 使用获取到的 Header 向 Jina 代理发起请求，并传入 signal
      proxyResponse = await fetch(prefixedUrl, {
        headers: headers as HeadersInit, // 类型断言
        signal: controller.signal // 关联 AbortController
      });
    } finally {
      // 无论 fetch 成功还是失败，都清除定时器
      clearTimeout(timeoutId);
    }

    // 7. 处理 Jina 代理的响应
    if (!proxyResponse.ok) {
      context.log(`Error fetching from Jina proxy: ${proxyResponse.status} ${proxyResponse.statusText}`);
      return new Response('Error fetching from Jina proxy: ' + proxyResponse.statusText, { status: proxyResponse.status });
    }

    // 读取 Jina 代理返回的文本内容
    const content = await proxyResponse.text();
    context.log('Successfully fetched content from Jina proxy.');

    // 8. 将获取到的内容返回给客户端
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });

  } catch (err: unknown) { // 使用 unknown 捕获错误
    // 9. 统一错误处理
    let errorMessage = 'An unknown error occurred';
    let errorStatus = 500;

    if (err instanceof Error) { // 检查 err 是否为 Error 实例
      errorMessage = err.message; // 安全地访问 message
      if (err.name === 'AbortError') {
        // 如果是超时错误
        context.log('Fetch aborted due to timeout:', err);
        errorMessage = 'Gateway Timeout: The request to the Jina proxy timed out.';
        errorStatus = 504; // 设置状态码为 504
      } else {
        // 其他类型的 Error
        context.log('An unexpected error occurred:', err);
        errorMessage = 'Internal Server Error: ' + err.message;
      }
    } else {
      // 如果 err 不是 Error 实例，记录原始错误信息
      context.log('An unexpected non-Error type was caught:', err);
    }

    // 返回错误状态和信息
    return new Response(errorMessage, { status: errorStatus });
  }
};

// 可选：为 Edge Function 配置路径
export const config = {
  path: "/api/jina-proxy" // 定义 Edge Function 的访问路径
};