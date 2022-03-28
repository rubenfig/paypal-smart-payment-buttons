/* @flow */
type LogServerSideCPLParams = {|
    cplPhases : Object,
    phase : string,
    category : string,
    isStart : ?boolean
|};

/**
 * Log performance metrics to send later
 * @param {Object} req
 * @param {String} phase
 * @param {String} category
 * @param {Boolean} isStart
 */
export const logServerSideCPL = ({ cplPhases, phase, category, isStart } : LogServerSideCPLParams) => {
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
