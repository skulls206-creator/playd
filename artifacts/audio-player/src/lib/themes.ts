export interface ThemeDef {
  label:   string;
  preview: { bg: string; accent: string };
  vars:    Record<string, string>;
}

export const THEMES: Record<string, ThemeDef> = {
  default: {
    label:   'Default',
    preview: { bg: '#09090b', accent: '#14b8a6' },
    vars: {
      '--background':                 '240 10% 4%',
      '--foreground':                 '240 5% 85%',
      '--card':                       '240 6% 7%',
      '--card-foreground':            '240 5% 85%',
      '--popover':                    '240 6% 7%',
      '--popover-foreground':         '240 5% 85%',
      '--primary':                    '173 80% 40%',
      '--primary-foreground':         '173 100% 10%',
      '--secondary':                  '240 6% 12%',
      '--secondary-foreground':       '240 5% 85%',
      '--muted':                      '240 6% 10%',
      '--muted-foreground':           '240 5% 65%',
      '--accent':                     '173 80% 40%',
      '--accent-foreground':          '173 100% 10%',
      '--border':                     '240 6% 15%',
      '--input':                      '240 6% 15%',
      '--ring':                       '173 80% 40%',
      '--sidebar':                    '240 10% 4%',
      '--sidebar-foreground':         '240 5% 85%',
      '--sidebar-border':             '240 6% 12%',
      '--sidebar-accent':             '240 6% 12%',
      '--sidebar-accent-foreground':  '240 5% 95%',
    },
  },

  discord: {
    label:   'Discord',
    preview: { bg: '#313338', accent: '#5865F2' },
    vars: {
      '--background':                 '224 6% 20%',   // #313338
      '--foreground':                 '220 9% 88%',   // #DBDEE1
      '--card':                       '222 6% 18%',   // #2B2D31
      '--card-foreground':            '220 9% 88%',
      '--popover':                    '222 6% 18%',
      '--popover-foreground':         '220 9% 88%',
      '--primary':                    '235 86% 65%',  // #5865F2 blurple
      '--primary-foreground':         '0 0% 100%',
      '--secondary':                  '224 7% 15%',
      '--secondary-foreground':       '220 9% 88%',
      '--muted':                      '224 7% 15%',
      '--muted-foreground':           '220 5% 53%',   // #80848E
      '--accent':                     '235 86% 65%',
      '--accent-foreground':          '0 0% 100%',
      '--border':                     '222 7% 23%',
      '--input':                      '222 7% 23%',
      '--ring':                       '235 86% 65%',
      '--sidebar':                    '222 7% 16%',   // #272A30
      '--sidebar-foreground':         '220 9% 88%',
      '--sidebar-border':             '222 7% 13%',
      '--sidebar-accent':             '224 7% 20%',
      '--sidebar-accent-foreground':  '220 9% 95%',
    },
  },

  discordDark: {
    label:   'Discord Dark',
    preview: { bg: '#1e1f22', accent: '#5865F2' },
    vars: {
      '--background':                 '240 7% 12%',   // #1E1F22
      '--foreground':                 '220 9% 88%',
      '--card':                       '240 8% 9%',    // #141417
      '--card-foreground':            '220 9% 88%',
      '--popover':                    '240 8% 9%',
      '--popover-foreground':         '220 9% 88%',
      '--primary':                    '235 86% 65%',
      '--primary-foreground':         '0 0% 100%',
      '--secondary':                  '240 7% 15%',
      '--secondary-foreground':       '220 9% 88%',
      '--muted':                      '240 8% 10%',
      '--muted-foreground':           '220 5% 53%',
      '--accent':                     '235 86% 65%',
      '--accent-foreground':          '0 0% 100%',
      '--border':                     '240 7% 17%',
      '--input':                      '240 7% 17%',
      '--ring':                       '235 86% 65%',
      '--sidebar':                    '240 8% 8%',    // #111214
      '--sidebar-foreground':         '220 9% 88%',
      '--sidebar-border':             '240 8% 7%',
      '--sidebar-accent':             '240 7% 12%',
      '--sidebar-accent-foreground':  '220 9% 95%',
    },
  },

  midnight: {
    label:   'Midnight',
    preview: { bg: '#0d1117', accent: '#6366f1' },
    vars: {
      '--background':                 '216 28% 7%',   // #0d1117
      '--foreground':                 '210 17% 88%',
      '--card':                       '215 25% 10%',
      '--card-foreground':            '210 17% 88%',
      '--popover':                    '215 25% 10%',
      '--popover-foreground':         '210 17% 88%',
      '--primary':                    '239 84% 67%',  // #6366f1 indigo
      '--primary-foreground':         '0 0% 100%',
      '--secondary':                  '215 25% 13%',
      '--secondary-foreground':       '210 17% 88%',
      '--muted':                      '215 25% 11%',
      '--muted-foreground':           '215 14% 55%',
      '--accent':                     '239 84% 67%',
      '--accent-foreground':          '0 0% 100%',
      '--border':                     '215 25% 16%',
      '--input':                      '215 25% 16%',
      '--ring':                       '239 84% 67%',
      '--sidebar':                    '216 28% 6%',
      '--sidebar-foreground':         '210 17% 88%',
      '--sidebar-border':             '216 28% 10%',
      '--sidebar-accent':             '215 25% 11%',
      '--sidebar-accent-foreground':  '210 17% 95%',
    },
  },

  amber: {
    label:   'Amber',
    preview: { bg: '#1c1710', accent: '#f59e0b' },
    vars: {
      '--background':                 '36 28% 8%',
      '--foreground':                 '36 15% 86%',
      '--card':                       '36 25% 11%',
      '--card-foreground':            '36 15% 86%',
      '--popover':                    '36 25% 11%',
      '--popover-foreground':         '36 15% 86%',
      '--primary':                    '38 92% 50%',   // #f59e0b amber
      '--primary-foreground':         '36 100% 5%',
      '--secondary':                  '36 25% 14%',
      '--secondary-foreground':       '36 15% 86%',
      '--muted':                      '36 25% 12%',
      '--muted-foreground':           '36 10% 55%',
      '--accent':                     '38 92% 50%',
      '--accent-foreground':          '36 100% 5%',
      '--border':                     '36 20% 18%',
      '--input':                      '36 20% 18%',
      '--ring':                       '38 92% 50%',
      '--sidebar':                    '36 30% 7%',
      '--sidebar-foreground':         '36 15% 86%',
      '--sidebar-border':             '36 25% 12%',
      '--sidebar-accent':             '36 25% 13%',
      '--sidebar-accent-foreground':  '36 15% 95%',
    },
  },

  rose: {
    label:   'Rose',
    preview: { bg: '#130a0c', accent: '#f43f5e' },
    vars: {
      '--background':                 '340 28% 6%',
      '--foreground':                 '340 10% 88%',
      '--card':                       '340 25% 9%',
      '--card-foreground':            '340 10% 88%',
      '--popover':                    '340 25% 9%',
      '--popover-foreground':         '340 10% 88%',
      '--primary':                    '347 77% 60%',  // #f43f5e rose
      '--primary-foreground':         '0 0% 100%',
      '--secondary':                  '340 25% 12%',
      '--secondary-foreground':       '340 10% 88%',
      '--muted':                      '340 25% 10%',
      '--muted-foreground':           '340 8% 55%',
      '--accent':                     '347 77% 60%',
      '--accent-foreground':          '0 0% 100%',
      '--border':                     '340 20% 16%',
      '--input':                      '340 20% 16%',
      '--ring':                       '347 77% 60%',
      '--sidebar':                    '340 30% 5%',
      '--sidebar-foreground':         '340 10% 88%',
      '--sidebar-border':             '340 25% 10%',
      '--sidebar-accent':             '340 25% 11%',
      '--sidebar-accent-foreground':  '340 10% 95%',
    },
  },
} satisfies Record<string, ThemeDef>;

export type ThemeKey = keyof typeof THEMES;
export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];
