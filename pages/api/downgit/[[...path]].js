// pages/api/downgit/[[...path]].js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    // /api/downgit + возможный путь → получим часть после /api/downgit
    const path = url.pathname.replace(/^\/api\/downgit/, '') || '/';
    const upstreamUrl = `https://downgitm.vercel.app${path}${url.search}`;

    // форвардим заголовки, но удалим/переопределим Host
    const headers = new Headers(req.headers);
    headers.delete('host'); // fetch поставит собственный host
    headers.set('x-forwarded-host', 'danzo.vercel.app');

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: (req.method === 'GET' || req.method === 'HEAD') ? undefined : await req.arrayBuffer()
    });

    const responseHeaders = new Headers(upstreamRes.headers);
    // Если есть CSP, оно может блокировать инъекции — удалим его для простоты
    responseHeaders.delete('content-security-policy');

    const contentType = upstreamRes.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      let text = await upstreamRes.text();

      // вставляем <base> чтобы относительные пути шли к downgitm
      const baseTag = `<base href="https://downgitm.vercel.app/">`;
      text = text.replace(/<head([^>]*)>/i, (m) => m + baseTag);

      // простая замена абсолютных ссылок /src и /href -> absolute
      text = text.replace(/href="\/([^"]*)"/g, 'href="https://downgitm.vercel.app/$1"');
      text = text.replace(/src="\/([^"]*)"/g, 'src="https://downgitm.vercel.app/$1"');
      text = text.replace(/action="\/([^"]*)"/g, 'action="https://downgitm.vercel.app/$1"');

      return new Response(text, { status: upstreamRes.status, headers: responseHeaders });
    }

    // не-HTML: проксируем байты напрямую
    const body = await upstreamRes.arrayBuffer();
    return new Response(body, { status: upstreamRes.status, headers: responseHeaders });
  } catch (err) {
    return new Response('Proxy error', { status: 502 });
  }
}
