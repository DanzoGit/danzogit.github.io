// app/api/downgit/[...path]/route.js
export const runtime = 'edge';

export async function GET(request, { params }) {
  try {
    const path = params.path ? '/' + params.path.join('/') : '/';
    const upstreamUrl = `https://downgitm.vercel.app${path}${new URL(request.url).search}`;

    const headers = new Headers(request.headers);
    headers.delete('host');

    const upstreamRes = await fetch(upstreamUrl, { method: 'GET', headers });
    const responseHeaders = new Headers(upstreamRes.headers);
    responseHeaders.delete('content-security-policy');

    const contentType = upstreamRes.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await upstreamRes.text();
      text = text.replace(/<head([^>]*)>/i, m => m + `<base href="https://downgitm.vercel.app/">`);
      text = text.replace(/href="\/([^"]*)"/g, 'href="https://downgitm.vercel.app/$1"');
      text = text.replace(/src="\/([^"]*)"/g, 'src="https://downgitm.vercel.app/$1"');
      return new Response(text, { status: upstreamRes.status, headers: responseHeaders });
    }

    const body = await upstreamRes.arrayBuffer();
    return new Response(body, { status: upstreamRes.status, headers: responseHeaders });
  } catch (err) {
    return new Response('Proxy error', { status: 502 });
  }
}
