// The authored sequence lives outside the component so tests can reason about the
// timing without importing React state.
export const WORDMARK_SEQUENCE=[
 {phase:'rest',hold:3600},
 {phase:'bars',hold:620},
 {phase:'fold',hold:760},
 {phase:'compact',hold:1200},
 {phase:'expand',hold:760},
 {phase:'rebuild',hold:1180},
 {phase:'rest',hold:27000}
];
export const WORDMARK_INTRO=1100;
