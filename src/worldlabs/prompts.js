/**
 * One World Labs prompt per story section.
 * Gaze on a section → show that section's generated Marble world.
 */
export const SCENE_PROMPTS = {
  ocean: {
    id: 'ocean',
    displayName: 'Stormy Ocean',
    model: 'marble-1.1',
    textPrompt:
      'A stormy open ocean at night, heavy rain, dark choppy waves, ' +
      'low storm clouds, distant lightning illuminating the horizon, ' +
      'wet atmosphere, cinematic immersive environment, no people, no text',
  },
  desert: {
    id: 'desert',
    displayName: 'Desert',
    model: 'marble-1.1',
    textPrompt:
      'An endless sun-baked desert of soft rolling dunes under a harsh ' +
      'bright sky, heat haze, sparse dry air, warm golden sand, ' +
      'cinematic immersive environment, no people, no text',
  },
};
