/**
 * O painel responde? — para o motor saber quando pode pedir avisos push.
 *
 * Aberta sem sessão e sem nada dentro: dizer "sim" não revela nada. O motor
 * perguntava a `/api/motores`, que agora exige sessão.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
