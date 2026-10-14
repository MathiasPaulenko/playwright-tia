declare global {
  var app: {
    loadA: () => Promise<string>;
    loadB: () => Promise<string>;
    mountFrame: (src: string) => void;
  };
}

// The fixture builds without the DOM lib — declare the bits it needs.
declare const document: {
  createElement(tag: string): { src: string };
  body: { appendChild(el: { src: string }): void };
};

async function loadA(): Promise<string> {
  const { featureA } = await import('./featureA.js');
  return featureA();
}

async function loadB(): Promise<string> {
  const { featureB } = await import('./featureB.js');
  return featureB();
}

function mountFrame(src: string): void {
  const iframe = document.createElement('iframe');
  iframe.src = src;
  document.body.appendChild(iframe);
}

globalThis.app = { loadA, loadB, mountFrame };

export {};
