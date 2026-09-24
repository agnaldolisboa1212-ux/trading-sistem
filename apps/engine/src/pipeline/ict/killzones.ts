// @ts-nocheck
export class Killzones {
  /**
   * Verifica se o timestamp atual cai dentro de uma Killzone do ICT.
   * As horas são baseadas em NY (EST/EDT).
   * 
   * ICT Silver Bullet Windows:
   * - London: 3:00 AM - 4:00 AM NY
   * - NY AM: 10:00 AM - 11:00 AM NY
   * - NY PM: 2:00 PM - 3:00 PM NY
   */
  public static isSilverBulletWindow(timestampMs: number): boolean {
    const date = new Date(timestampMs);
    
    // Converte para o fuso horário de New York
    const nyTimeString = date.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const nyDate = new Date(nyTimeString);
    
    const hour = nyDate.getHours();
    
    const isLondonSB = hour === 3;
    const isNyAmSB = hour === 10;
    const isNyPmSB = hour === 14; // 2 PM
    
    return isLondonSB || isNyAmSB || isNyPmSB;
  }
  
  public static isLondonKillzone(timestampMs: number): boolean {
    const date = new Date(timestampMs);
    const nyDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nyDate.getHours();
    return hour >= 2 && hour < 5;
  }

  public static isNYKillzone(timestampMs: number): boolean {
    const date = new Date(timestampMs);
    const nyDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nyDate.getHours();
    return hour >= 7 && hour < 10;
  }
}
