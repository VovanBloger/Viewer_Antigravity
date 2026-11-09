import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStyleDiff,
  buildIdeDeepLink,
  buildConsolidatedAgentPrompt,
  analyzeElementAuditIssues,
  calculateFitZoom,
  DEFAULT_TUNER_STATE,
  AgentQueueItem,
} from './antigravity-core';
import {
  computeResizedBox,
  computeResponsiveWidthPercent,
  convertLayerSizingUnit,
  reorderLayerList,
  formatLayerBuilderDiff,
  DesignLayerNode,
  hexToHsv,
  hsvToHex,
  rgbStringToHex,
} from './layer-builder';

test('computeStyleDiff detects opacity, border radius, alignment, and class changes', () => {
  const initial = { ...DEFAULT_TUNER_STATE, bgOpacity: 100, radiusVal: 16, align: 'none' as const };
  const current = { ...DEFAULT_TUNER_STATE, bgOpacity: 0, radiusVal: 24, align: 'center' as const };

  const diffs = computeStyleDiff(initial, current, 'p-4 rounded-2xl bg-[#1C1A2B]', 'p-4 rounded-3xl bg-transparent');
  assert.equal(diffs.length, 4);
  assert.equal(diffs[0].property, 'Прозрачность фона');
  assert.equal(diffs[0].tailwindSuggestion, 'bg-transparent');
  assert.equal(diffs[1].property, 'Выравнивание');
  assert.equal(diffs[2].tailwindSuggestion, 'rounded-[24px]');
});

test('buildIdeDeepLink formats vscode and antigravity URIs accurately', () => {
  const uri = buildIdeDeepLink('components/demo/DemoApp.tsx', 142, 'vscode');
  assert.equal(uri, 'vscode://file/components/demo/DemoApp.tsx:142:1');

  const agUri = buildIdeDeepLink('/app/page.tsx', 55, 'antigravity');
  assert.equal(agUri, 'antigravity://file/app/page.tsx:55:1');
});

test('buildConsolidatedAgentPrompt generates structured multi-element markdown', () => {
  const item: AgentQueueItem = {
    id: 'q-1',
    pinNumber: 1,
    createdAt: '12:00:00',
    slotDeviceName: 'iPhone 16 Pro',
    priority: 'high',
    directiveId: 'responsive-320',
    note: 'Сделать карточку компактнее на узких экранах',
    element: {
      tag: 'div',
      className: 'p-3.5 rounded-2xl bg-[#1C1A2B]',
      textSnippet: 'Кибер-Кот #01',
      rect: { top: 240, left: 16, width: 361, height: 82 },
      selector: 'main > div.space-y-2.5 > div',
      componentName: 'DemoApp',
      sourceFile: 'components/demo/DemoApp.tsx',
      sourceLine: 145,
      layerIndex: 0,
      totalLayers: 2,
    },
    diffs: [
      {
        property: 'Прозрачность фона',
        before: '100%',
        after: '0%',
        tailwindSuggestion: 'bg-transparent',
      },
    ],
  };

  const md = buildConsolidatedAgentPrompt([item], {
    url: '/demo',
    theme: 'Antigravity Obsidian',
    activeDevices: ['iPhone 16 Pro'],
  });

  assert.ok(md.includes('[Пин #1] <div> в компоненте `DemoApp`'));
  assert.ok(md.includes('components/demo/DemoApp.tsx:145'));
  assert.ok(md.includes('bg-transparent'));
  assert.ok(md.includes('Адаптировать под 320px'));
});

test('analyzeElementAuditIssues flags horizontal overflow and small touch targets', () => {
  const issues = analyzeElementAuditIssues(
    [
      {
        tag: 'button',
        selector: 'header > button.tiny',
        textSnippet: 'X',
        componentName: 'DemoApp',
        sourceFile: 'components/demo/DemoApp.tsx',
        sourceLine: 48,
        rect: { top: 10, left: 350, width: 24, height: 24, right: 374, bottom: 34 },
        scrollWidth: 24,
        clientWidth: 24,
        isInteractive: true,
      },
      {
        tag: 'div',
        selector: 'main > div.wide-banner',
        textSnippet: 'Overflowing banner',
        rect: { top: 120, left: 0, width: 450, height: 80, right: 450, bottom: 200 },
        scrollWidth: 450,
        clientWidth: 393,
        isInteractive: false,
      },
    ],
    393,
    59,
    34,
    852
  );

  assert.ok(issues.some((i) => i.category === 'touch-target'));
  assert.ok(issues.some((i) => i.category === 'safe-area'));
  assert.ok(issues.some((i) => i.category === 'overflow-x'));
});

test('calculateFitZoom scales multi-slot workspace within bounds', () => {
  const zoom = calculateFitZoom(
    [
      { w: 393, h: 852, rotated: false, showBezel: true },
      { w: 412, h: 915, rotated: false, showBezel: true },
    ],
    1000,
    820
  );
  assert.ok(zoom >= 0.25 && zoom <= 1.0);
});

test('computeResizedBox calculates 8-handle resize and grid snapping accurately', () => {
  const start = { dx: 0, dy: 0, width: 200, height: 100 };
  const resizedSE = computeResizedBox(start, 'se', 43, 29, 8);
  assert.equal(resizedSE.width, 240);
  assert.equal(resizedSE.height, 128);
  assert.equal(resizedSE.dx, 0);

  const resizedNW = computeResizedBox(start, 'nw', -16, -24, 8);
  assert.equal(resizedNW.width, 216);
  assert.equal(resizedNW.height, 128);
  assert.equal(resizedNW.dx, -16);
  assert.equal(resizedNW.dy, -24);
});

test('reorderLayerList swaps layer order and formatLayerBuilderDiff produces Tailwind classes', () => {
  const baseLayer: DesignLayerNode = {
    id: 'layer-1',
    name: 'HeroBannerCard',
    tag: 'div',
    selector: 'main > div',
    depth: 1,
    parentId: null,
    isGroup: false,
    childIds: [],
    visible: true,
    locked: false,
    initialRect: { x: 16, y: 100, width: 350, height: 180 },
    currentRect: { x: 32, y: 116, width: 320, height: 220 },
    transform: { dx: 16, dy: 16, width: 320, height: 220, zIndex: 20, orderIndex: 0 },
  };
  const secondLayer: DesignLayerNode = {
    ...baseLayer,
    id: 'layer-2',
    name: 'SearchInputBar',
    transform: { ...baseLayer.transform, orderIndex: 1 },
  };

  const reordered = reorderLayerList([baseLayer, secondLayer], 'layer-2', 'up');
  assert.equal(reordered[0].id, 'layer-2');
  assert.equal(reordered[1].id, 'layer-1');

  const diff = formatLayerBuilderDiff(baseLayer, []);
  assert.ok(diff.tailwindClasses.includes('translate-x-[16px]'));
  assert.ok(diff.tailwindClasses.includes('w-[320px]'));
  assert.ok(diff.tailwindClasses.includes('h-[220px]'));
  assert.ok(diff.tailwindClasses.includes('z-[20]'));
});

test('formatLayerBuilderDiff supports responsive % sizing, text edits, and SVG icon replacements', () => {
  const pct = computeResponsiveWidthPercent(306, 360);
  assert.equal(pct, 85);

  const leafTextAndIconLayer: DesignLayerNode = {
    id: 'layer-CardTitle_card-1',
    name: 'CardTitle_card-1 ("Нейро-Кот #99")',
    tag: 'h3',
    selector: 'main > div > h3',
    depth: 2,
    parentId: 'layer-FeatureCard_card-1',
    isGroup: false,
    childIds: [],
    visible: true,
    locked: false,
    nodeKind: 'text',
    initialTextValue: 'Кибер-Кот #01',
    textValue: 'Нейро-Кот #99',
    hasSvgIcon: true,
    iconPresetId: 'crown',
    iconColor: '#F59E0B',
    parentWidth: 360,
    initialRect: { x: 20, y: 200, width: 360, height: 24 },
    currentRect: { x: 20, y: 200, width: 306, height: 24 },
    transform: {
      dx: 0,
      dy: 0,
      width: 306,
      height: 24,
      zIndex: 0,
      orderIndex: 3,
      widthUnit: '%',
      widthPercent: 85,
      responsivePreset: 'none',
    },
  };

  const diff = formatLayerBuilderDiff(leafTextAndIconLayer, []);
  assert.ok(diff.summaryLines.some((s) => s.includes('Кибер-Кот #01') && s.includes('Нейро-Кот #99')));
  assert.ok(diff.summaryLines.some((s) => s.includes('<Crown />')));
  assert.ok(diff.tailwindClasses.includes('w-[85%] max-w-full'));
  assert.ok(diff.tailwindClasses.includes('text-[#F59E0B]'));

  const toPx = convertLayerSizingUnit(leafTextAndIconLayer, 'px');
  assert.equal(toPx.widthUnit, 'px');
  assert.equal(toPx.width, 306);

  const backToPct = convertLayerSizingUnit(
    { ...leafTextAndIconLayer, transform: { ...leafTextAndIconLayer.transform, ...toPx } },
    '%'
  );
  assert.equal(backToPct.widthUnit, '%');
  assert.equal(backToPct.widthPercent, 85);

  const alignedLayer: DesignLayerNode = {
    ...leafTextAndIconLayer,
    textColor: '#38BDF8',
    transform: {
      ...leafTextAndIconLayer.transform,
      boxAlign: 'right',
      contentAlign: 'center',
    },
  };
  const alignedDiff = formatLayerBuilderDiff(alignedLayer, []);
  assert.ok(alignedDiff.tailwindClasses.includes('ml-auto mr-0 self-end'));
  assert.ok(alignedDiff.tailwindClasses.includes('text-center justify-center items-center'));
  assert.ok(alignedDiff.tailwindClasses.includes('text-[#38BDF8]'));
  assert.ok(alignedDiff.summaryLines.some((s) => s.includes('Цвет текста: #38BDF8')));

  const hsv = hexToHsv('#FFB1B1');
  assert.equal(hsv.h, 0);
  const roundTrip = hsvToHex(hsv.h, hsv.s, hsv.v);
  assert.match(roundTrip, /^#[0-9A-F]{6}$/);
  assert.equal(hsvToHex(0, 100, 100), '#FF0000');
  assert.equal(hsvToHex(120, 100, 100), '#00FF00');
  assert.notEqual(rgbStringToHex('oklch(0.714 0.203 305.504)', '#FFFFFF'), '#FFFFFF');
  assert.notEqual(rgbStringToHex('oklab(0.289 0.091 -0.134 / 0.9)', '#FFFFFF'), '#FFFFFF');
});
