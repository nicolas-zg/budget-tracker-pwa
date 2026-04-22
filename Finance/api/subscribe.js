export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body ?? {};

  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Valid email address required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase environment variables');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/subscribers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      email: normalizedEmail,
      source: req.headers['referer'] ?? 'direct',
      created_at: new Date().toISOString(),
    }),
  });

  // 409 = unique constraint violation (duplicate email)
  if (response.status === 409) {
    return res.status(200).json({ already: true });
  }

  if (!response.ok) {
    const body = await response.text();
    console.error('Supabase error:', response.status, body);
    return res.status(500).json({ error: 'Failed to save. Please try again.' });
  }

  return res.status(200).json({ success: true });
}
