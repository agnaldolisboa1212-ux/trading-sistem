/**
 * Estado dos motores e últimos sinais de tempo real, para o painel sondar.
 *
 * Sondado de 15 em 15 segundos pelo `PainelMotores`. É barato: dois ficheiros
 * locais ou duas consultas pequenas ao Supabase.
 */

import { NextResponse } from 'next/server';
import { lerEstadoMotores, lerSinaisTempoReal } from '@/lib/motores';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [estado, sinais] = await Promise.all([lerEstadoMotores(), lerSinaisTempoReal(8)]);
  return NextResponse.json({ estado, sinais }, { headers: { 'Cache-Control': 'no-store' } });
}
