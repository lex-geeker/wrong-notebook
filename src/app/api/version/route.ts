import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const version = readFileSync(join(process.cwd(), 'VERSION'), 'utf-8').trim();
    return NextResponse.json({ version });
  } catch {
    return NextResponse.json({ version: 'unknown' });
  }
}
