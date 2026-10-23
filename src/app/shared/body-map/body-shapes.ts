/**
 * Géométrie de la silhouette (vue de face, viewBox 0 0 330 360), par identifiant de zone du catalogue.
 * Les zones sans géométrie (visage entier, espace latéral) restent sélectionnables par la liste.
 * Les zones latérales (tempe, joue, oreille, épaule, bras, coude, poignet) ne sont pas latéralisées : les deux côtés
 * sélectionnent la même zone.
 */
export type BodyShape =
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number }
  | { kind: 'path'; d: string };

const ellipse = (cx: number, cy: number, rx: number, ry: number): BodyShape => ({ kind: 'ellipse', cx, cy, rx, ry });
const rect = (x: number, y: number, width: number, height: number, rx = 8): BodyShape => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
  rx,
});

export const BODY_VIEWBOX = '0 0 330 360';

/** Contour décoratif (non cliquable). */
export const BODY_OUTLINE = [
  'M130,12 C160,12 178,38 178,70 C178,104 158,128 130,128 C102,128 82,104 82,70 C82,38 100,12 130,12 Z',
  'M116,126 L116,146 L80,152 C62,156 54,170 52,190 L50,300 L74,300 L76,200 L96,190 L98,300 L162,300 L164,190 L184,200 L186,300 L210,300 L208,190 C206,170 198,156 180,152 L144,146 L144,126',
];

/** Point d'ancrage du numéro d'ordre affiché sur une zone sélectionnée. */
export interface BodyZoneGeometry {
  shapes: BodyShape[];
  badge: { x: number; y: number };
}

export const BODY_ZONES: Record<string, BodyZoneGeometry> = {
  zone_head: { shapes: [{ kind: 'path', d: 'M92,38 A48,58 0 0 1 168,38 Z' }], badge: { x: 130, y: 26 } },
  zone_forehead: { shapes: [ellipse(130, 50, 28, 9)], badge: { x: 130, y: 50 } },
  zone_temple: { shapes: [ellipse(93, 54, 7, 8), ellipse(167, 54, 7, 8)], badge: { x: 93, y: 54 } },
  zone_eyes: { shapes: [ellipse(112, 68, 11, 6), ellipse(148, 68, 11, 6)], badge: { x: 130, y: 68 } },
  zone_nose: { shapes: [ellipse(130, 84, 7, 10)], badge: { x: 130, y: 84 } },
  zone_cheek: { shapes: [ellipse(101, 93, 10, 12), ellipse(159, 93, 10, 12)], badge: { x: 101, y: 93 } },
  zone_ear: { shapes: [ellipse(79, 76, 7, 14), ellipse(181, 76, 7, 14)], badge: { x: 79, y: 76 } },
  zone_mouth: { shapes: [ellipse(130, 103, 15, 6)], badge: { x: 130, y: 103 } },
  zone_chin: { shapes: [ellipse(130, 119, 15, 6)], badge: { x: 130, y: 119 } },
  zone_neck: { shapes: [rect(117, 130, 26, 16, 4)], badge: { x: 130, y: 138 } },
  zone_shoulder: { shapes: [ellipse(84, 160, 20, 11), ellipse(176, 160, 20, 11)], badge: { x: 84, y: 160 } },
  zone_torso: { shapes: [rect(100, 166, 60, 64)], badge: { x: 130, y: 198 } },
  zone_belly: { shapes: [rect(100, 234, 60, 58)], badge: { x: 130, y: 263 } },
  zone_arm: { shapes: [rect(54, 176, 20, 98, 10), rect(186, 176, 20, 98, 10)], badge: { x: 196, y: 205 } },
  // Après le bras dans le catalogue : dessinés par-dessus, donc cliquables.
  zone_elbow: { shapes: [ellipse(64, 234, 11, 9), ellipse(196, 234, 11, 9)], badge: { x: 196, y: 234 } },
  zone_wrist: { shapes: [ellipse(64, 278, 11, 5), ellipse(196, 278, 11, 5)], badge: { x: 196, y: 278 } },
  zone_other_hand: { shapes: [ellipse(62, 300, 13, 19)], badge: { x: 62, y: 300 } },
  zone_neutral: { shapes: [rect(232, 150, 88, 120, 12)], badge: { x: 276, y: 210 } },
};
