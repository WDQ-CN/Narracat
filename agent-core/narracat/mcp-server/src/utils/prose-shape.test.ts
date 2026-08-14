import { describe, expect, it } from "vitest";
import { scanProseShape } from "./prose-shape.js";

/** 一段正常网文正文：长短句相间、有对白、段落有高低差 */
const HEALTHY = `# 第 001 章 · 大梦初醒

少年从一场漫长的梦里醒来时，窗外正落着今年的第一场雪。

他记得梦里有一座很高的山，山顶坐着一个白发苍苍的老人，老人手里握着一卷看不见尽头的书。老人说，世人皆在梦中，醒得早的便能多走一程，醒不来的就把一辈子过成了别人写好的故事。少年想问那卷书里写了什么，话还没出口，山就塌了。

“阿砚，发什么呆，柴火都快灭了。”

灶台前的妇人回过头，鬓角已经有了白霜。林砚慌忙把手里的枯枝塞进灶膛，火舌腾地窜起来，映得他半张脸通红。他叫这妇人婶娘，五岁那年被丢在青石镇的桥洞下，是她把他捡回来，一碗稀粥一碗稀粥地喂到十六岁。

镇子很小，小到一眼能望到头。镇上的人世世代代守着一句老话，莫问山外事，莫做登天梦。林砚不懂，山外面到底有什么，值得整座镇子用一辈子去回避。`;

/** 五个短促单句段，每段都过「≥4 汉字」的入段门槛 */
const DRUMBEAT = ["他走出了门。", "风已经停了。", "门还开着。", "天彻底黑了。", "屋里没有人。"];

const ids = (text: string) => scanProseShape(text).map((f) => f.id);

describe("scanProseShape — 正文形状扫描（finding-only）", () => {
  it("健康正文不报形状问题", () => {
    expect(ids(HEALTHY)).toEqual([]);
  });

  it("空文本 / 纯标题返回空", () => {
    expect(scanProseShape("")).toEqual([]);
    expect(scanProseShape("# 第 001 章")).toEqual([]);
  });

  it("整章压成等长短句 → 句长过近 + 叙述切碎", () => {
    const text = Array.from({ length: 30 }, (_, i) => `他抬起头看了看天。风把门吹开了${i}。`).join(
      "\n\n",
    );
    const found = ids(text);
    expect(found).toContain("sentence_length_uniform");
  });

  it("叙述句大量超短 → tiny_sentence_flood", () => {
    const paras = Array.from(
      { length: 12 },
      () => "他停下。风起了。门开了。她走了。天亮了，屋子里只剩下没烧完的柴火和一地灰。",
    );
    expect(ids(paras.join("\n\n"))).toContain("tiny_sentence_flood");
  });

  it("连续短促单句段 → 短段鼓点，detail 带段号", () => {
    const text = DRUMBEAT.join("\n\n");
    const finding = scanProseShape(text).find((f) => f.id === "short_paragraph_drumbeat");
    expect(finding).toBeDefined();
    expect(finding!.detail).toMatch(/第 1 段起连续/);
  });

  it("不足四汉字的行不计入段落（避免把分行标记当段）", () => {
    const text = ["他走了。", "风停了。", "门开着。", "天黑了。"].join("\n\n");
    expect(ids(text)).toEqual([]);
  });

  it("对白段不被算成短段鼓点（小说适配）", () => {
    const text = ["“走。”", "“不走。”", "“你听我说。”", "“我不听。”", "“那就算了。”"].join(
      "\n\n",
    );
    expect(ids(text)).not.toContain("short_paragraph_drumbeat");
    expect(ids(text)).not.toContain("one_sentence_paragraph_flood");
  });

  it("段落绝大多数单句 → 段落形状单一", () => {
    const text = Array.from(
      { length: 12 },
      (_, i) => `他把手里的东西放下，抬头看了看窗外正在落的雪${i}。`,
    ).join("\n\n");
    expect(ids(text)).toContain("one_sentence_paragraph_flood");
  });

  it("长前置成分超限 → 主干来得太晚", () => {
    const para =
      "在他把那封信从抽屉最底下翻出来又读了一遍以后，屋子里已经没有别人了。在她终于愿意把那天夜里发生的事情原原本本说出来之后，他反而不知道该问什么了。在那场雪落下来把整座镇子盖住之前，谁也没有想过山外面还有人会来。";
    expect(ids(para)).toContain("late_subject");
  });

  it("长句堆四个以上「的」超限 → 长定语堆叠（偶发一句不报）", () => {
    const sentence =
      "那个从山外面来的浑身是血的修士怀里死死护着的那枚温润的玉简，此刻正躺在灶台边上的柴堆里。";
    expect(ids(sentence)).not.toContain("heavy_de_sentence");
    expect(ids(sentence.repeat(3))).toContain("heavy_de_sentence");
  });

  it("同构排比成串才报，单处放行（真稿里单处多是合法群像扫描）", () => {
    const one = "他站在原地，不知道山在哪里，不知道路有多远，不知道自己还能走多久。";
    expect(ids(one)).not.toContain("anaphora_run");
    const finding = scanProseShape(`${one}\n\n${one}`).find((f) => f.id === "anaphora_run");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("第 1 段");
  });

  it("对白段里的三连不算同构排比（台词三连是人物在使劲）", () => {
    const line = "“别提爹，别提医，别提剑。”";
    expect(ids(`${line}\n\n${line}\n\n${line}`)).not.toContain("anaphora_run");
  });

  it("同一个词反复起段 → 段落开场重复", () => {
    const text = Array.from(
      { length: 5 },
      (_, i) => `其实他早就知道这件事会这样收场，只是一直没有说出口${i}。`,
    ).join("\n\n");
    const finding = scanProseShape(text).find((f) => f.id === "repeated_opener");
    expect(finding).toBeDefined();
    expect(finding!.detail).toContain("「其实」");
  });

  it("连词密度过高 → conjunction_density", () => {
    const para =
      "因为他没有听清，所以又问了一遍，但是对方并不想回答，而且已经转身往门口走，因此他只好跟上去，同时把桌上的东西收进袖子里，此外他还记得婶娘交代过的话，并且一直放在心上，然而这一次他并不打算照做，不仅如此，他甚至想过再也不回来。";
    expect(ids(para.repeat(8))).toContain("conjunction_density");
  });

  it("单换行分段的正文也能切段", () => {
    expect(ids(DRUMBEAT.join("\n"))).toContain("short_paragraph_drumbeat");
  });

  it("所有 finding 都带 label / detail / hint，且 detail 不含阈值处方", () => {
    const text = DRUMBEAT.join("\n\n");
    for (const f of scanProseShape(text)) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.detail.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(0);
      expect(f.hint).not.toMatch(/目标|阈值|不超过|占比应/);
    }
  });
});
