/**
 * 슬래시 커맨드 정의.
 *
 * 기존에는 discord.py가 실행될 때 tree.sync()로 자동 등록했지만, Workers에는 상주 프로세스가
 * 없으므로 등록은 `npm run register` 스크립트로 분리했다. 명령어를 추가/수정하면 이 파일을
 * 고친 뒤 반드시 스크립트를 한 번 실행해야 Discord에 반영된다.
 *
 * 런타임 코드를 끌어오지 않도록 이 파일은 의존성 없이 순수 데이터만 담는다.
 */

const CHAT_INPUT = 1;
const INTEGER = 4;
const USER = 6;

/** src/db.ts의 MAX_SET_COUNT와 값을 맞춰둔다. */
const MAX_SET_COUNT = 500;

export interface CommandOption {
  name: string;
  description: string;
  type: number;
  required: boolean;
  min_value?: number;
  max_value?: number;
}

export interface CommandDefinition {
  name: string;
  description: string;
  type: number;
  options?: CommandOption[];
}

export const COMMANDS: CommandDefinition[] = [
  {
    name: "글작성인증",
    description: "오늘도 수고하셨습니다!! (하루 1회)",
    type: CHAT_INPUT,
  },
  {
    name: "규칙",
    description: "글쓰기 활동 규칙을 안내합니다.",
    type: CHAT_INPUT,
  },
  {
    name: "글작성현황",
    description: "이번 달 전체 멤버의 글 작성 횟수를 표시합니다.",
    type: CHAT_INPUT,
  },
  {
    name: "월별글작성현황",
    description: "특정 연월의 글 작성 현황을 표시합니다. (생략 시 이번 달)",
    type: CHAT_INPUT,
    options: [
      {
        name: "year",
        description: "조회할 연도 (예: 2026, 생략 시 올해)",
        type: INTEGER,
        required: false,
      },
      {
        name: "month",
        description: "조회할 월 (1-12, 생략 시 이번 달)",
        type: INTEGER,
        required: false,
      },
    ],
  },
  {
    name: "오늘글작성현황",
    description: "오늘 글을 작성한 멤버 목록을 표시합니다.",
    type: CHAT_INPUT,
  },
  {
    name: "글작성횟수추가",
    description: "[관리자] 특정 멤버의 글 작성 횟수를 추가합니다. (생략 시 이번 달 1회)",
    type: CHAT_INPUT,
    options: [
      { name: "member", description: "횟수를 추가할 멤버", type: USER, required: true },
      {
        name: "count",
        description: "추가할 횟수 (생략 시 1)",
        type: INTEGER,
        required: false,
        min_value: 1,
        max_value: MAX_SET_COUNT,
      },
      {
        name: "year",
        description: "적용할 연도 (예: 2026, 생략 시 올해)",
        type: INTEGER,
        required: false,
      },
      {
        name: "month",
        description: "적용할 월 (1-12, 생략 시 이번 달)",
        type: INTEGER,
        required: false,
      },
    ],
  },
  {
    name: "글작성횟수차감",
    description: "[관리자] 특정 멤버의 글 작성 횟수를 차감합니다. (생략 시 이번 달 1회)",
    type: CHAT_INPUT,
    options: [
      { name: "member", description: "횟수를 차감할 멤버", type: USER, required: true },
      {
        name: "count",
        description: "차감할 횟수 (생략 시 1)",
        type: INTEGER,
        required: false,
        min_value: 1,
        max_value: MAX_SET_COUNT,
      },
      {
        name: "year",
        description: "적용할 연도 (예: 2026, 생략 시 올해)",
        type: INTEGER,
        required: false,
      },
      {
        name: "month",
        description: "적용할 월 (1-12, 생략 시 이번 달)",
        type: INTEGER,
        required: false,
      },
    ],
  },
  {
    name: "글작성횟수설정",
    description: "[관리자] 특정 멤버의 이번 달 글 작성 횟수를 지정한 값으로 설정합니다.",
    type: CHAT_INPUT,
    options: [
      { name: "member", description: "횟수를 설정할 멤버", type: USER, required: true },
      { name: "count", description: "설정할 횟수", type: INTEGER, required: true },
    ],
  },
];
