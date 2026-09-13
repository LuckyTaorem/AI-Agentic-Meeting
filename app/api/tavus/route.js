import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    
    const response = await fetch('https://tavusapi.com/v2/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.TAVUS_API_KEY
      },
      body: JSON.stringify({
        ...body,
        webhook_url: "https://clubenglish.app.n8n.cloud/webhook-test/tavus-post-call", 
      })
    });

    if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json({ error: 'Tavus API Error', details: errorText }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
    
  } catch (error) {
    return NextResponse.json({ error: 'Server Connection Failed', details: error.message }, { status: 500 });
  }
}