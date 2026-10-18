/**
 * @fileOverview Flujo de Inteligencia de Ventas con IA.
 * Se ha eliminado 'use server' para permitir la exportación estática de Next.js.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AISalesIntelInputSchema = z.object({
  salesData: z.array(z.any()),
  exchangeRateBSUSD: z.number()
});

export type AISalesIntelInput = z.infer<typeof AISalesIntelInputSchema>;

const AISalesIntelOutputSchema = z.object({
  restockingRecommendations: z.array(z.object({
    productName: z.string(),
    quantityToOrder: z.number(),
    reason: z.string()
  })),
  weeklySalesForecast: z.object({
    totalRevenueUSD: z.number(),
    totalRevenueBS: z.number(),
    forecastDetails: z.string()
  })
});

export type AISalesIntelOutput = z.infer<typeof AISalesIntelOutputSchema>;

export async function getAISalesIntel(input: AISalesIntelInput): Promise<AISalesIntelOutput> {
  const { output } = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    input: input,
    output: { schema: AISalesIntelOutputSchema },
    prompt: `Actúa como un experto analista de inventarios para una licorería en Venezuela.
    Basado en estos datos de ventas: ${JSON.stringify(input.salesData)} 
    y la tasa actual de ${input.exchangeRateBSUSD} Bs/USD.
    
    Proporciona recomendaciones de reabastecimiento y una proyección de ventas para la próxima semana.`
  });
  return output!;
}
