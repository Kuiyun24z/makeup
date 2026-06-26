const COMMAND_VERBS = /(试试|试一下|试一试|换成|换一支|换个|涂|画个|画一下|来一个|来个|用一下|切到|上一个)/;
const CLEAR_RE = /(卸妆|清空妆|清除妆|关掉试妆|关闭试妆|不要试妆)/;
const RESTORE_RE = /(恢复|复原|打开试妆|开启试妆|继续试妆)/;
const DEEPEN_RE = /(深一点|浓一点|重一点|加深|调深|更显色)/;
const LIGHTEN_RE = /(浅一点|淡一点|轻一点|减淡|调浅|自然一点)/;
const LIP_RE = /(口红|唇釉|唇彩|唇妆|嘴唇|唇色)/;
const BLUSH_RE = /(腮红|脸颊|颊彩)/;
const BROW_RE = /(眉笔|眉粉|眉色|眉毛|眉形)/;
const EYESHADOW_RE = /(眼影|眼妆)/;

const CATEGORY_LABELS = { lip: "口红", blush: "腮红", brow: "眉色", eyeshadow: "眼影" };

function detectCategory(text) {
  if (BLUSH_RE.test(text)) return "blush";
  if (EYESHADOW_RE.test(text)) return "eyeshadow";
  if (BROW_RE.test(text)) return "brow";
  if (LIP_RE.test(text)) return "lip";
  return null;
}

export function parseMakeupCommand(input, catalog = []) {
  const raw = String(input || "").trim();
  const text = normalizeText(raw);
  if (!text) return { type: "none" };

  if (CLEAR_RE.test(text)) {
    return {
      type: "clear",
      message: "已卸掉试妆效果。需要恢复时输入“恢复试妆”就可以。",
    };
  }

  if (RESTORE_RE.test(text)) {
    return {
      type: "restore",
      message: "已恢复默认试妆效果。",
    };
  }

  if (DEEPEN_RE.test(text) || LIGHTEN_RE.test(text)) {
    const target = detectCategory(text) || "lip";
    const delta = DEEPEN_RE.test(text) ? 12 : -12;
    return {
      type: "adjust",
      target,
      delta,
      message: `${CATEGORY_LABELS[target]}强度已${delta > 0 ? "加深" : "减淡"}。`,
    };
  }

  const commandIntent = COMMAND_VERBS.test(text);
  if (!commandIntent) return { type: "none" };

  const category = detectCategory(text);
  const item = matchCatalogItem(text, catalog, category);
  if (item) {
    return {
      type: "apply",
      category: item.category,
      item,
      message: `已试上${item.name}${item.name.includes(CATEGORY_LABELS[item.category] || "") ? "" : CATEGORY_LABELS[item.category] || ""}。`,
    };
  }

  return {
    type: "unknownColor",
    category,
    message: "色库里暂时没有找到这个颜色。可以试试豆沙口红、枫叶红、蜜桃腮红、大地色眼影或深棕眉色。",
  };
}

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:："'“”‘’（）()【】\[\]\s]/g, "");
}

export function matchCatalogItem(text, catalog, category = null) {
  const normalized = normalizeText(text);
  const entries = Array.isArray(catalog) ? catalog : [];
  const candidates = [];

  for (const item of entries) {
    if (category && item.category !== category) continue;
    const names = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])]
      .map(normalizeText)
      .filter(Boolean);
    for (const name of names) {
      if (!normalized.includes(name)) continue;
      candidates.push({ item, score: name.length });
      break;
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.item || null;
}
