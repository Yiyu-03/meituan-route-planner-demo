import type { Constraints, Route } from '../types';

export interface ReplanChip {
  text: string;
  instruction: string;
  emphasize?: boolean;
}

export function buildReplanChips(route: Route, c: Constraints): ReplanChip[] {
  const chips: ReplanChip[] = [];
  const cats = new Set(route.stops.map((stop) => stop.scored.poi.category));
  const overBudget = c.budgetPerCapita != null && route.totalCost > c.budgetPerCapita;
  const hasHotQueue = route.stops.some((stop) => stop.scored.poi.queueBase >= 0.65);

  if (overBudget) chips.push({ text: '便宜一点', instruction: '换家更便宜的', emphasize: true });

  if (hasHotQueue && cats.has('dining')) {
    chips.push({ text: '这家排队太久，换一个', instruction: '换一家评分更高的餐厅' });
  } else if (cats.has('dining')) {
    chips.push({ text: '换家更好吃的', instruction: '换一家评分更高的餐厅' });
  }

  if (cats.has('cafe')) chips.push({ text: '咖啡换近一点的', instruction: '换一家更近的咖啡' });

  chips.push({ text: '走太多路了', instruction: '不要太赶' });
  chips.push({ text: '想多拍点照', instruction: '加一个适合拍照的地方' });
  chips.push({ text: '再多逛一个地方', instruction: '再多逛一个地方' });

  const seen = new Set<string>();
  return chips
    .filter((chip) => {
      if (seen.has(chip.instruction)) return false;
      seen.add(chip.instruction);
      return true;
    })
    .slice(0, 5);
}
