export function resendLoginMailer(env) {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.CRM_EMAIL_FROM?.trim();
  if (!key || !from) return null;
  return async (email, link) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [email], subject: 'Tu enlace de acceso a David Llanos Coaching',
        text: 'Abre este enlace para entrar en David Llanos Coaching:\n\n' + link +
          '\n\nEl enlace caduca en 15 minutos y sirve una sola vez. Si no lo pediste, puedes ignorar este correo.'
      })
    });
    if (!response.ok) throw Error('No se pudo enviar el correo.');
  };
}
