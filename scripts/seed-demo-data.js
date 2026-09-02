const { PrismaClient } = require('@prisma/client');

const DEMO_MARKER = '__demo__';
const DAY_MS = 24 * 60 * 60 * 1000;

const questions = [
    { key: 'p_math_multiply', subject: '数学', source: 'homework', errorType: null, tags: ['两位数乘法'], question: '计算：36 × 4 = ?', answer: '144', wrong: '124', analysis: '把 36 分成 30 和 6，分别乘 4，再相加：120 + 24 = 144。', createdDaysAgo: 5 },
    { key: 'p_cn_reading', subject: '语文', source: 'homework', errorType: null, tags: ['阅读理解'], question: '读句子：“小雨停了，蜘蛛又坐在网上。”这句话说明天气发生了什么变化？', answer: '雨停了，天气由下雨转为放晴或不再下雨。', wrong: '蜘蛛在织网。', analysis: '抓住“小雨停了”这个直接表示天气变化的词语。', createdDaysAgo: 4 },
    { key: 'p_en_grammar', subject: '英语', source: 'quiz', errorType: null, tags: ['一般现在时'], question: '改错：Does she likes apples?', answer: 'Does she like apples?', wrong: 'Does she likes apples?', analysis: '助动词 does 后面的动词使用原形。', createdDaysAgo: 3 },
    { key: 'p_math_perimeter', subject: '数学', source: 'exam', errorType: 'reading', tags: ['长方形周长'], question: '一个长方形长 8 厘米、宽 5 厘米，它的周长是多少厘米？', answer: '26 厘米', wrong: '40 厘米', analysis: '周长是四条边的总长度：(8 + 5) × 2 = 26。', createdDaysAgo: 2, geogebra: ['A=(0,0)', 'B=(8,0)', 'C=(8,5)', 'D=(0,5)', 'Polygon(A,B,C,D)'] },
    { key: 'p_cn_punctuation', subject: '语文', source: 'other', errorType: 'omission', tags: ['标点符号'], question: '给句子加标点：妈妈问 你写完作业了吗', answer: '妈妈问：“你写完作业了吗？”', wrong: '妈妈问，你写完作业了吗。', analysis: '人物说的话用引号，疑问句末尾用问号。', createdDaysAgo: 1 },
    { key: 'd_math_division', subject: '数学', source: 'homework', errorType: 'method', tags: ['有余数除法'], question: '有 29 个苹果，每 4 个装一袋，可以装满几袋，还剩几个？', answer: '7 袋，还剩 1 个', wrong: '6 袋，还剩 5 个', analysis: '29 ÷ 4 = 7……1，余数必须小于除数。', createdDaysAgo: 12, masteryLevel: 2 },
    { key: 'd_en_spelling', subject: '英语', source: 'quiz', errorType: 'knowledge', tags: ['单词拼写'], question: '根据中文写单词：星期三', answer: 'Wednesday', wrong: 'Wensday', analysis: 'Wednesday 中间包含 d，按音节和字母组合记忆。', createdDaysAgo: 11, masteryLevel: 0 },
    { key: 'd_cn_reading', subject: '语文', source: 'exam', errorType: 'reading', tags: ['阅读理解'], question: '“太阳像一个大火球”运用了什么修辞手法？把什么比作什么？', answer: '比喻，把太阳比作大火球。', wrong: '拟人。', analysis: '句中有“像”，并把太阳和大火球两个不同事物作比较。', createdDaysAgo: 10, masteryLevel: 0 },
    { key: 'd_math_length', subject: '数学', source: 'homework', errorType: 'calculation_writing', tags: ['长度单位'], question: '3 米 6 分米等于多少分米？', answer: '36 分米', wrong: '306 分米', analysis: '1 米 = 10 分米，所以 3 米 = 30 分米，再加 6 分米。', createdDaysAgo: 8, masteryLevel: 1 },
    { key: 'd_en_present', subject: '英语', source: 'homework', errorType: 'method', tags: ['一般现在时'], question: '用所给词填空：Tom ___ (go) to school by bus every day.', answer: 'goes', wrong: 'go', analysis: '主语 Tom 是第三人称单数，一般现在时动词用 goes。', createdDaysAgo: 8, masteryLevel: 2 },
    { key: 'd_cn_sentence', subject: '语文', source: 'homework', errorType: 'reading', tags: ['修改病句'], question: '修改病句：我估计他今天一定不会来了。', answer: '我估计他今天不会来了。', wrong: '我估计他今天一定不会来了。', analysis: '“估计”和“一定”语意矛盾，删去其中一个。', createdDaysAgo: 6, masteryLevel: 0 },
    { key: 'f_math_fraction', subject: '数学', source: 'quiz', errorType: 'knowledge', tags: ['分数初步'], question: '把一个正方形平均分成 8 份，涂了 3 份，涂色部分用分数怎样表示？', answer: '3/8', wrong: '8/3', analysis: '分母表示平均分成的份数，分子表示取出的份数。', createdDaysAgo: 0, masteryLevel: 0 },
    { key: 'f_en_reading', subject: '英语', source: 'exam', errorType: 'reading', tags: ['英语阅读'], question: 'Read: “Lucy has a red bag.” What color is Lucy’s bag?', answer: 'It is red.', wrong: 'It is blue.', analysis: '题目问颜色，原句中的关键词是 red。', createdDaysAgo: 2, masteryLevel: 1 },
    { key: 'd_cn_poem', subject: '语文', source: 'quiz', errorType: 'knowledge', tags: ['古诗积累'], question: '补全诗句：停车坐爱枫林晚，___。', answer: '霜叶红于二月花', wrong: '霜叶红似二月花', analysis: '杜牧《山行》原句是“霜叶红于二月花”。', createdDaysAgo: 1, masteryLevel: 0 },
];

const completedSessions = [
    { daysAgo: 6, items: [['d_math_length', true], ['d_math_division', true], ['d_en_spelling', false]] },
    { daysAgo: 4, items: [['d_math_division', true], ['d_cn_reading', true], ['d_cn_sentence', true]] },
    { daysAgo: 2, items: [['d_en_spelling', false], ['d_math_length', true], ['d_cn_sentence', false]] },
    { daysAgo: 1, items: [['d_math_division', true], ['d_cn_reading', false], ['d_en_present', true]] },
];

function daysAgo(days, hourOffset = 0) {
    return new Date(Date.now() - days * DAY_MS + hourOffset * 60 * 60 * 1000);
}

function sessionItem(item, position, variant = false) {
    return {
        errorItemId: item.id,
        position,
        subjectName: item.subject.name,
        gradeSemester: item.gradeSemester,
        knowledgePoints: JSON.stringify(item.tags.map((tag) => tag.name)),
        sourceQuestionText: item.questionText,
        sourceAnswerText: item.answerText,
        questionText: variant ? `同类练习：${item.questionText}` : item.questionText,
        answerText: item.answerText,
        generationMode: variant ? 'variant' : 'original',
    };
}

async function createCompletedSession(prisma, userId, itemByKey, spec) {
    const endedAt = daysAgo(spec.daysAgo);
    const session = await prisma.practiceSession.create({
        data: {
            userId,
            mode: 'daily',
            questionSource: 'variant',
            language: 'zh',
            startedAt: new Date(endedAt.getTime() - 15 * 60 * 1000),
            endedAt,
            items: {
                create: spec.items.map(([key], index) => sessionItem(itemByKey.get(key), index, true)),
            },
        },
        include: { items: { orderBy: { position: 'asc' } } },
    });

    await prisma.practiceRecord.createMany({
        data: session.items.map((sessionEntry, index) => {
            const [key, isCorrect] = spec.items[index];
            const item = itemByKey.get(key);
            return {
                userId,
                sessionItemId: sessionEntry.id,
                errorItemId: item.id,
                subject: item.subject.name,
                isCorrect,
                answerInput: null,
                createdAt: endedAt,
            };
        }),
    });
}

async function main() {
    const prisma = new PrismaClient();
    const email = process.argv[2] || 'admin@localhost';

    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) throw new Error(`User not found: ${email}`);

        const oldDemoItems = await prisma.errorItem.findMany({
            where: { userId: user.id, ocrText: DEMO_MARKER },
            select: { id: true },
        });
        const oldIds = oldDemoItems.map(({ id }) => id);
        if (oldIds.length) {
            await prisma.practiceSession.deleteMany({
                where: { userId: user.id, items: { some: { errorItemId: { in: oldIds } } } },
            });
            await prisma.errorItem.deleteMany({ where: { id: { in: oldIds }, userId: user.id } });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { educationStage: 'primary', enrollmentYear: 2024 },
        });

        const subjects = new Map();
        for (const name of ['数学', '语文', '英语']) {
            const subject = await prisma.subject.upsert({
                where: { name_userId: { name, userId: user.id } },
                update: {},
                create: { name, userId: user.id },
            });
            subjects.set(name, subject);
        }

        const subjectKeys = { 数学: 'math', 语文: 'chinese', 英语: 'english' };
        const tags = new Map();
        for (const definition of questions) {
            for (const name of definition.tags) {
                const key = `${definition.subject}:${name}`;
                if (tags.has(key)) continue;
                const subject = subjectKeys[definition.subject];
                const existing = await prisma.knowledgeTag.findFirst({
                    where: { name, subject, userId: user.id, parentId: null, isSystem: false },
                });
                tags.set(key, existing || await prisma.knowledgeTag.create({
                    data: { name, subject, userId: user.id, parentId: null, isSystem: false },
                }));
            }
        }

        const itemByKey = new Map();
        for (const definition of questions) {
            const item = await prisma.errorItem.create({
                data: {
                    userId: user.id,
                    subjectId: subjects.get(definition.subject).id,
                    originalImageUrl: '',
                    ocrText: DEMO_MARKER,
                    questionText: definition.question,
                    answerText: definition.answer,
                    analysis: definition.analysis,
                    wrongAnswerText: definition.wrong,
                    mistakeAnalysis: definition.errorType ? `本题主要属于“${definition.errorType}”类型错误。` : null,
                    mistakeStatus: 'wrong_attempt',
                    geogebraCommands: definition.geogebra ? JSON.stringify(definition.geogebra) : null,
                    source: definition.source,
                    errorType: definition.errorType,
                    userNotes: '家庭测试样本，可编辑或删除。',
                    masteryLevel: definition.masteryLevel || 0,
                    gradeSemester: '三年级上学期',
                    paperLevel: definition.source === 'exam' ? 'b' : 'a',
                    createdAt: daysAgo(definition.createdDaysAgo),
                    tags: { connect: definition.tags.map((name) => ({ id: tags.get(`${definition.subject}:${name}`).id })) },
                },
                include: { subject: true, tags: true },
            });
            itemByKey.set(definition.key, item);
        }

        for (const spec of completedSessions) await createCompletedSession(prisma, user.id, itemByKey, spec);

        const activeKeys = ['p_math_multiply', 'p_cn_reading', 'p_en_grammar', 'd_en_spelling', 'd_cn_reading'];
        await prisma.practiceSession.create({
            data: {
                userId: user.id,
                mode: 'daily',
                questionSource: 'variant',
                language: 'zh',
                items: {
                    create: activeKeys.map((key, index) => sessionItem(itemByKey.get(key), index, true)),
                },
            },
        });

        const [itemCount, completedCount, activeCount] = await Promise.all([
            prisma.errorItem.count({ where: { userId: user.id, ocrText: DEMO_MARKER } }),
            prisma.practiceSession.count({ where: { userId: user.id, mode: 'daily', endedAt: { not: null }, items: { some: { errorItem: { ocrText: DEMO_MARKER } } } } }),
            prisma.practiceSession.count({ where: { userId: user.id, mode: 'daily', endedAt: null, items: { some: { errorItem: { ocrText: DEMO_MARKER } } } } }),
        ]);
        if (itemCount !== questions.length || completedCount !== completedSessions.length || activeCount !== 1) {
            throw new Error('Demo data verification failed');
        }

        console.log(JSON.stringify({ email, errorItems: itemCount, completedDailySessions: completedCount, activeDailySessions: activeCount }, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
