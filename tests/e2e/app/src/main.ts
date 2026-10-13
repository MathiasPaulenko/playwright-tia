declare global {
  var app: { loadA: () => Promise<string>; loadB: () => Promise<string> };
}

async function loadA(): Promise<string> {
  const { featureA } = await import('./featureA.js');
  return featureA();
}

async function loadB(): Promise<string> {
  const { featureB } = await import('./featureB.js');
  return featureB();
}

globalThis.app = { loadA, loadB };

export {};
