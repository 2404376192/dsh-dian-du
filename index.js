/**
 * 点读笔 — Host half.
 *
 * Registers the `/dian-du` command. The Client panel runs it in a dedicated
 * side Session and shows the returned text, so explaining a marked passage
 * never adds a message to the conversation you are reading.
 *
 * The command input is a JSON object carried in the command's raw input:
 *   { "items": [{ "text": "..." }], "question": "..." }
 */

export const inject = ['commands', 'llm'];

const INSTRUCTIONS = [
  '你是一个耐心、擅长打比方的一对一辅导老师。',
  '用户会给你几段他看不懂的原文片段，以及他的问题。',
  '请只针对片段里真正难懂的地方解释：先用一句话说人话，再拆开讲原因，必要时给一个很小的例子。',
  '不要整段复述原文，不要用「首先/其次/最后」这类空话，不要输出 Markdown 标题。',
  '如果片段是代码或公式，逐部分说明它在做什么。',
  '用中文回答，控制在 400 字以内。',
].join('\n');

function textOf(value) {
  return typeof value === 'string' ? value : String(value ?? '');
}

function failureText(error) {
  if (!error) return '未知错误';
  return error.message || error.code || String(error);
}

export function apply(ctx, config) {
  const provider = (config && config.provider) || 'deepseek-official';
  const model = (config && config.model) || 'deepseek-flash';

  ctx.effect(() =>
    ctx.commands.register({
      name: 'dian-du',
      description: 'Explain the passages marked in the reading pen panel',
      input: { hint: '{"items":[{"text":"…"}],"question":"…"}' },
      handler: async ({ rawInput }) => {
        let payload;
        try {
          payload = JSON.parse(rawInput);
        } catch {
          payload = { items: [], question: textOf(rawInput) };
        }

        const items = Array.isArray(payload && payload.items) ? payload.items : [];
        const question = textOf(payload && payload.question).trim();
        const marked = items
          .map((item) => textOf(item && item.text).trim())
          .filter((text) => text.length > 0);

        if (marked.length === 0 && question.length === 0) {
          return { kind: 'error', text: '没有收到要解释的内容' };
        }

        const userText = [
          INSTRUCTIONS,
          '',
          marked.length
            ? '我标记的原文：\n' + marked.map((text, i) => `${i + 1}. ${text}`).join('\n')
            : '',
          '',
          '我的问题：' + (question || '请用更简单的方式解释这些内容，我哪里没看懂就讲哪里。'),
        ].join('\n');

        let answer = '';
        try {
          for await (const chunk of ctx.llm.stream({
            provider,
            model,
            messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
          })) {
            if (chunk && chunk.type === 'text-delta') answer += textOf(chunk.text);
          }
        } catch (error) {
          return { kind: 'error', text: '模型调用失败：' + failureText(error) };
        }

        const trimmed = answer.trim();
        if (!trimmed) {
          return {
            kind: 'error',
            text: '模型没有返回内容（provider: ' + provider + ', model: ' + model + '）',
          };
        }
        return { kind: 'success', text: trimmed };
      },
    }),
  );
}
