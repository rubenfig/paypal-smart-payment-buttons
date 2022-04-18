/* @flow */

/**
 * Log performance metrics to send later
 * @param {Object} cplPhases
 * @param {String} phase
 * @param {String} category
 * @param {Boolean} isStart
 */
export const logCPLMetrics = (cplPhases : Object, phase : string, category : string, isStart : ?boolean) => {
    if (!cplPhases) {
        cplPhases = {
            query: {},
            chunk: {},
            comp:  {}
        };
    }
    const epochNow = Date.now();
    if (category && cplPhases[category] && phase) {
        if (isStart && !cplPhases[category][phase]) {
            cplPhases[category][phase] = {
                start: epochNow
            };
        } else if (cplPhases[category][phase]) {
            if (
                cplPhases[category][phase].start &&
                !cplPhases[category][phase].tt
            ) {
                cplPhases[category][phase].tt =
                    epochNow - cplPhases[category][phase].start;
            }
        }
    }
};
