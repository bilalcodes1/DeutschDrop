const LEVEL_THRESHOLDS = [
    { level: 1, xp: 0 },
    { level: 2, xp: 500 },
    { level: 3, xp: 1500 },
    { level: 4, xp: 3000 },
    { level: 5, xp: 5500 },
    { level: 6, xp: 9000 },
    { level: 7, xp: 14000 },
    { level: 8, xp: 21000 },
    { level: 9, xp: 30000 },
    { level: 10, xp: 42000 },
];

export function getLevelFromXp(totalXp: number): { level: number; nextLevelXp: number | null } {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
        if (totalXp >= LEVEL_THRESHOLDS[i].xp) {
            const nextLevel = LEVEL_THRESHOLDS[i + 1];
            return {
                level: LEVEL_THRESHOLDS[i].level,
                nextLevelXp: nextLevel ? nextLevel.xp : null,
            };
        }
    }
    return { level: 1, nextLevelXp: LEVEL_THRESHOLDS[1]?.xp ?? null };
}

export function getProgressToNextLevel(totalXp: number): { currentLevel: number; current: number; target: number | null; percent: number } {
    const { level, nextLevelXp } = getLevelFromXp(totalXp);
    if (!nextLevelXp) {
        return { currentLevel: level, current: totalXp, target: null, percent: 100 };
    }
    const prevLevelXp = LEVEL_THRESHOLDS.find(l => l.level === level)?.xp ?? 0;
    const range = nextLevelXp - prevLevelXp;
    const currentInRange = totalXp - prevLevelXp;
    const percent = Math.min(100, Math.round((currentInRange / range) * 100));
    return { currentLevel: level, current: totalXp, target: nextLevelXp, percent };
}
