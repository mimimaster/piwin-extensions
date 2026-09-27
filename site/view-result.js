// Outcome of a generated entry: problems (same rules as CI) or JSON + actions.
import { h } from './dom.js';
import { icon } from './ui.js';

export function resultBlock(problems, text, actions, note) {
  if (problems.length > 0) {
    return [
      h('div', { class: 'callout danger', role: 'alert' },
        icon('alert', 18),
        h('div', {},
          h('strong', {}, `还有 ${problems.length} 个问题`),
          h('span', { class: 'callout-sub' }, '和仓库 CI 用的是同一套规则'),
          h('ul', {}, problems.map((problem) => h('li', {}, problem))),
        ),
      ),
    ];
  }
  return [
    h('div', { class: 'callout ok' }, icon('check', 18), h('strong', {}, '通过检查，可以提交')),
    h('pre', { class: 'json' }, text),
    h('div', { class: 'actions' }, actions),
    h('p', { class: 'fine' }, note),
  ];
}
