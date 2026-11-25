/**
 * Web Worker that fits blocks of a surface's field for the surface worker,
 * several at the same time (features/model/pou.ts, `fitBlockTask`): the
 * same code as a fit in one worker, so the same answer to the last digit.
 */
import { fitBlockTask, type BlockAnswer, type BlockTask } from '../features/model/pou';

self.onmessage = (e: MessageEvent) => {
    const { id, tasks } = e.data as { id: number; tasks: BlockTask[] };
    const answers: BlockAnswer[] = [];
    const transfer: Transferable[] = [];
    for (const task of tasks) {
        let answer: BlockAnswer = null;
        try {
            answer = fitBlockTask(task);
        } catch {
            answer = null;
        }
        answers.push(answer);
        if (answer) transfer.push(answer.field.centres.buffer, answer.field.weights.buffer);
    }
    (self as unknown as Worker).postMessage({ id, answers }, transfer);
};
