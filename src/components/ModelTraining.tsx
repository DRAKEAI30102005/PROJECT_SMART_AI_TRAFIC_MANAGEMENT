import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FolderTree,
  Play,
  TerminalSquare,
  Video,
} from 'lucide-react';

interface ModelTrainingProps {
  onBack: () => void;
}

const classes = ['car', 'motorcycle', 'bus', 'truck', 'ambulance'];

const steps = [
  'Upload the four CCTV videos into public/videos as video1.mp4 to video4.mp4.',
  'Extract clean frames from each video with the provided Python script.',
  'Label every visible car, motorcycle, bus, truck, and ambulance in YOLO format.',
  'Train a YOLO model with the supplied dataset.yaml and training script.',
  'Validate on unseen footage and keep improving the labels until false detections drop.',
];

const commands = [
  'python -m venv .venv',
  '.venv\\Scripts\\activate',
  'pip install -r ml\\requirements.txt',
  'python ml\\scripts\\extract_frames.py --video-dir public\\videos --output-dir ml\\datasets\\traffic_vehicles\\images\\raw --frames-per-video 300',
  'python ml\\scripts\\train_yolo.py --data ml\\datasets\\traffic_vehicles\\dataset.yaml --model yolov8m.pt --epochs 100 --imgsz 1280 --batch 8',
];

export function ModelTraining({ onBack }: ModelTrainingProps) {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-medium text-cyan-300 transition-colors hover:border-cyan-700 hover:text-cyan-200"
          >
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="max-w-3xl text-right">
            <h1 className="text-3xl font-bold tracking-tight text-white">YOLO Training Workspace</h1>
            <p className="mt-2 text-sm text-slate-400">
              This project now includes a real training pipeline for detecting {classes.join(', ')} from your
              traffic footage.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40">
            <div className="mb-6 flex items-start gap-3">
              <div className="rounded-xl bg-cyan-500/10 p-3 text-cyan-300">
                <ClipboardList size={22} />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">What this setup does</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  It prepares a custom YOLO dataset from your videos, trains on the five required classes, and saves
                  the model outputs under `ml/runs/detect`. Accuracy depends mostly on label quality, class balance,
                  lighting coverage, camera angle diversity, and validation on unseen footage.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Target classes</h3>
                <div className="flex flex-wrap gap-2">
                  {classes.map((label) => (
                    <span
                      key={label}
                      className="rounded-full border border-cyan-900/70 bg-cyan-500/10 px-3 py-1 text-sm text-cyan-100"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Included assets</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    Frame extraction script
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    YOLO dataset template
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    Train and infer commands
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400" />
                    Practical quality checklist
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-amber-900/40 bg-amber-500/10 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="mt-0.5 text-amber-300" />
                <div>
                  <h3 className="font-semibold text-amber-100">Important reality check</h3>
                  <p className="mt-2 text-sm leading-6 text-amber-50/85">
                    No YOLO model can be guaranteed to have zero errors on every frame. What we can do is build a much
                    stronger custom detector by using high-quality labels, enough ambulance examples, hard negative
                    cases, and repeated validation on footage the model has never seen before.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
              <div className="mb-4 flex items-center gap-3">
                <Video className="text-cyan-300" size={20} />
                <h2 className="text-lg font-semibold text-white">Training flow</h2>
              </div>
              <ol className="space-y-3 text-sm text-slate-300">
                {steps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-bold text-cyan-200">
                      {index + 1}
                    </span>
                    <span className="leading-6">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
              <div className="mb-4 flex items-center gap-3">
                <FolderTree className="text-cyan-300" size={20} />
                <h2 className="text-lg font-semibold text-white">Project folders</h2>
              </div>
              <div className="rounded-xl border border-slate-800 bg-black/40 p-4 font-mono text-xs leading-6 text-slate-300">
                public/videos
                <br />
                ml/datasets/traffic_vehicles/images
                <br />
                ml/datasets/traffic_vehicles/labels
                <br />
                ml/scripts
                <br />
                ml/runs/detect
              </div>
            </div>
          </aside>
        </div>

        <section className="rounded-2xl border border-slate-800 bg-black/40 shadow-2xl shadow-slate-950/40">
          <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-3">
            <TerminalSquare size={18} className="text-slate-300" />
            <span className="text-sm font-medium text-slate-300">Suggested commands</span>
          </div>
          <div className="space-y-3 p-5 font-mono text-sm text-slate-200">
            {commands.map((command) => (
              <div key={command} className="rounded-lg border border-slate-800 bg-slate-950/70 px-4 py-3">
                <span className="text-cyan-300">$ </span>
                {command}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold text-white">
              <Play size={18} className="text-cyan-300" />
              How to improve precision
            </h2>
            <ul className="space-y-3 text-sm leading-6 text-slate-300">
              <li>Keep the `ambulance` class separate and label many angles, distances, day/night conditions, and partial occlusions.</li>
              <li>Do not mix motorcycles with bicycles. If bicycles appear often, leave them unlabeled only if you truly do not want that class.</li>
              <li>Label every visible target object in a frame, not just the biggest one.</li>
              <li>Use separate validation footage from different times or cameras so the scores are meaningful.</li>
              <li>Review false positives after each run and add those hard cases back into the dataset.</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">What to do next</h2>
            <p className="text-sm leading-6 text-slate-300">
              The repository is ready for real YOLO training, but the model still needs labeled data before it can be
              trained properly. Use a labeling tool such as Label Studio, CVAT, or Roboflow to annotate the extracted
              frames in YOLO format, then run the training command shown above.
            </p>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Once training finishes, the best weights will typically be saved as
              `ml/runs/detect/traffic_vehicles/weights/best.pt`.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
