const CONTROL_MESSAGES = {
  smoothing: {
    increase: [
      "我帮你轻轻柔化了一下肌肤哦，看起来更细腻啦。",
      "给你加了一点点柔肤感，皮肤看起来更清透舒服啦。",
    ],
    decrease: [
      "我把柔肤感收了一点哦，现在会更自然、更有肌肤质感。",
      "帮你减轻了一点磨皮感，这样看起来更真实自然啦。",
    ],
    off: [
      "我帮你关掉柔肤效果啦，现在保留最自然的肌肤质感。",
      "柔肤效果已经帮你去掉啦，看看原生质感是不是也很好看。",
    ],
  },
  whitening: {
    increase: [
      "我帮你提亮了一点哦，气色看起来更透亮啦。",
      "给你加了一点清透亮感，整个人看起来更有精神啦。",
    ],
    decrease: [
      "我把亮度收柔了一点哦，现在肤色会更自然耐看。",
      "帮你减轻了一点提亮感，这样看起来更柔和啦。",
    ],
    off: [
      "我帮你关掉提亮效果啦，现在就是更自然的原生肤色。",
      "提亮效果已经帮你去掉啦，保留自然气色也很舒服哦。",
    ],
  },
  faceSlim: {
    increase: [
      "我帮你稍微修饰了一下脸型哦，轮廓看起来更精致自然啦。",
      "给你的脸部轮廓轻轻收了一点，整体更利落啦。",
    ],
    decrease: [
      "我把脸型修饰收了一点哦，现在轮廓会更柔和自然。",
      "帮你减轻了一点瘦脸感，这样看起来更松弛、更舒服啦。",
    ],
    off: [
      "我帮你去掉脸型修饰啦，自然轮廓也很有自己的特点哦。",
      "瘦脸效果已经关掉啦，现在保留你原本自然的脸部线条。",
    ],
  },
  eyeEnlarge: {
    increase: [
      "我帮你把眼神提亮了一点哦，看起来更有神啦。",
      "给眼睛加了一点灵动感，整个人都更精神啦。",
    ],
    decrease: [
      "我把大眼效果收了一点哦，现在眼神会更自然柔和。",
      "帮你减轻了一点眼睛放大感，这样比例更舒服啦。",
    ],
    off: [
      "我帮你关掉大眼效果啦，保留自然眼型也很耐看哦。",
      "眼睛放大效果已经去掉啦，现在看起来更自然。",
    ],
  },
  mouthResize: {
    increase: [
      "我帮你把唇形放大了一点哦，看起来更饱满啦。",
      "给唇形加了一点存在感，整体会更有气色哦。",
    ],
    decrease: [
      "我帮你把唇形轻轻收了一点哦，现在比例更秀气自然。",
      "给唇形收小了一点，整体看起来更柔和啦。",
    ],
    off: [
      "我帮你恢复自然唇形啦，现在看起来很舒服哦。",
      "唇形修饰已经去掉啦，保留原本的比例更自然。",
    ],
  },
  noseResize: {
    increase: [
      "我帮你稍微调整了一下鼻型哦，五官比例更舒展啦。",
      "给鼻型加了一点轮廓感，整体看起来更立体啦。",
    ],
    decrease: [
      "我帮你把鼻型轻轻收了一点哦，现在五官更精致自然。",
      "给鼻型做了一点柔和的收拢，比例看起来更舒服啦。",
    ],
    off: [
      "我帮你恢复自然鼻型啦，原本的五官比例就很舒服哦。",
      "鼻型修饰已经去掉啦，现在保留自然轮廓。",
    ],
  },
  eyebrow: {
    increase: [
      "我帮你把眉毛稍微加深了一点哦，五官看起来更有精神啦。",
      "给眉毛添了一点轮廓感，整个人都更利落啦。",
    ],
    decrease: [
      "我把眉色收淡了一点哦，现在看起来更柔和自然。",
      "帮你减轻了一点眉毛的存在感，整体更清透啦。",
    ],
    off: [
      "我帮你去掉眉毛增强效果啦，现在保留自然眉色。",
      "眉毛效果已经关掉啦，原本的眉形也很舒服哦。",
    ],
  },
  blusher: {
    increase: [
      "我帮你加了一点腮红哦，气色看起来更元气啦。",
      "给脸颊添了一点自然红润感，整个人更有活力啦。",
    ],
    decrease: [
      "我把腮红收淡了一点哦，现在会更清透自然。",
      "帮你减轻了一点红润感，这样看起来更日常啦。",
    ],
    off: [
      "我帮你把腮红淡掉啦，现在是清爽自然的气色。",
      "腮红效果已经去掉啦，整体看起来更干净自然。",
    ],
  },
};

const WARM_MIRROR_STYLE_INSTRUCTION = [
  "你的人格是温柔、亲切的闺蜜型美妆伙伴，说话自然，有适度的情绪价值。",
  "先肯定用户当前状态或选择，再给一条轻松、具体、可执行的建议。",
  "回复控制在 1 到 3 句，不说教，不使用客服腔或说明书式措辞。",
  "不要贬低长相、指出所谓缺陷或制造容貌焦虑，也不要使用必须改善之类的判断。",
  "不要机械播报美颜参数数值、具体数值或后台执行过程。",
  "可以自然使用“哦、啦、呀”等语气词，但不要每句话都堆叠，也不要过度夸张效果。",
].join("\n");

function stableIndex(text, length) {
  const source = String(text || "");
  let hash = 0;
  for (const character of source) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }
  return length ? hash % length : 0;
}

function resolveDirection(command) {
  if (command?.mode === "off" || Number(command?.value) === 0 && command?.mode !== "increase") {
    return "off";
  }
  if (command?.mode === "decrease") {
    return "decrease";
  }
  if (command?.mode === "absolute") {
    return Number(command.value) < Number(command.previousValue) ? "decrease" : "increase";
  }
  return "increase";
}

function buildGpupixelControlMessage(command) {
  const direction = resolveDirection(command);
  const featureMessages = CONTROL_MESSAGES[command?.key];
  const options = featureMessages?.[direction] || [
    direction === "decrease"
      ? `我帮你把${command?.label || "这个效果"}收柔了一点哦，现在看起来更自然啦。`
      : direction === "off"
      ? `我帮你关掉${command?.label || "这个效果"}啦，现在看起来更自然。`
      : `我帮你稍微调整了一下${command?.label || "这个效果"}哦，看看现在是不是更喜欢啦。`,
  ];
  const seed = `${command?.key || ""}:${direction}:${command?.text || ""}`;
  return options[stableIndex(seed, options.length)];
}

function joinMirrorReply(controlMessage, adviceText) {
  const control = String(controlMessage || "").trim();
  const advice = String(adviceText || "")
    .trim()
    .replace(/^[。！？!?；;，,\s]+/u, "");
  if (!control) {
    return advice;
  }
  if (!advice) {
    return control;
  }
  const separator = /[。！？!?；;]$/u.test(control) ? "" : "。";
  return `${control}${separator}${advice}`;
}

module.exports = {
  buildGpupixelControlMessage,
  joinMirrorReply,
  WARM_MIRROR_STYLE_INSTRUCTION,
};
