import { motion } from 'framer-motion';

const shellAnimations = {
  idle: {
    scale: [1, 1.03, 1],
    opacity: [0.65, 0.82, 0.65],
    rotate: [0, 0, 0],
  },
  listening: {
    scale: [1, 1.08, 1],
    opacity: [0.75, 1, 0.78],
    rotate: [0, -4, 4, -4, 0],
  },
  thinking: {
    scale: [1, 1.12, 0.98, 1.08, 1],
    opacity: [0.72, 0.95, 0.8, 0.96, 0.72],
    rotate: [0, 0, 0],
  },
  speaking: {
    scale: [1, 1.15, 1.04, 1.12, 1],
    opacity: [0.74, 1, 0.85, 0.96, 0.74],
    rotate: [0, -2, 2, -2, 0],
  },
};

const coreAnimations = {
  idle: {
    scale: [1, 1.01, 1],
  },
  listening: {
    scale: [1, 1.03, 1],
  },
  thinking: {
    scale: [1, 1.05, 0.99, 1.03, 1],
  },
  speaking: {
    scale: [1, 1.06, 1.01, 1.05, 1],
  },
};

const shellTransition = {
  duration: 2.2,
  ease: 'easeInOut',
  repeat: Infinity,
};

const coreTransition = {
  duration: 2,
  ease: 'easeInOut',
  repeat: Infinity,
};

const activityLabels = {
  idle: 'Standing By',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

function JarvisAvatar({ activity }) {
  return (
    <div className="relative h-[18rem] w-[18rem] sm:h-[21rem] sm:w-[21rem]">
      <motion.div
        className="absolute inset-0 rounded-full border border-cyan-200/25 bg-cyan-300/10 shadow-[0_0_90px_rgba(34,211,238,0.35)]"
        animate={shellAnimations[activity]}
        transition={shellTransition}
      />

      <motion.div
        className="absolute inset-6 rounded-full border border-white/10 bg-slate-950/70 backdrop-blur"
        animate={coreAnimations[activity]}
        transition={coreTransition}
      />

      <div className="absolute inset-12 rounded-full border border-cyan-100/12 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.22),transparent_55%)]" />

      <div className="absolute inset-0 z-10 flex items-center justify-center">
        <div className="flex translate-y-1 flex-col items-center text-center sm:translate-y-1.5">
          <div className="text-xs font-semibold leading-none tracking-[0.45em] text-cyan-100/80">
            AI CORE
          </div>
          <div className="mt-3 flex h-[4.6rem] w-[4.6rem] items-center justify-center sm:h-[5.3rem] sm:w-[5.3rem]">
            <div className="text-6xl font-bold leading-none text-white sm:text-7xl">
              J
            </div>
          </div>
          <div className="mt-3 text-sm font-semibold leading-none tracking-[0.3em] text-slate-300">
            {activityLabels[activity]}
          </div>
        </div>
      </div>

      <div className="absolute bottom-12 left-1/2 flex -translate-x-1/2 items-end gap-2 sm:bottom-14">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="block w-2 rounded-full bg-cyan-300"
            animate={{
              height:
                activity === 'listening'
                  ? ['0.8rem', '2rem', '1rem']
                  : activity === 'thinking'
                    ? ['0.9rem', '1.6rem', '1rem']
                    : activity === 'speaking'
                      ? ['1rem', '2.4rem', '1.1rem']
                      : ['0.75rem', '1rem', '0.75rem'],
              opacity:
                activity === 'idle'
                  ? [0.45, 0.65, 0.45]
                  : [0.65, 1, 0.72],
            }}
            transition={{
              duration: 0.9,
              ease: 'easeInOut',
              repeat: Infinity,
              delay: index * 0.16,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default JarvisAvatar;
