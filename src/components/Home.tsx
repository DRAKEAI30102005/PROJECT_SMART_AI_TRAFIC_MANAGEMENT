import React from 'react';
import {
  Ambulance,
  ArrowRight,
  BarChart3,
  Cpu,
  Globe,
  LineChart,
  Monitor,
  Terminal,
  Timer,
} from 'lucide-react';

interface HomeProps {
  onNavigateToDashboard: () => void;
}

export function Home({ onNavigateToDashboard }: HomeProps) {
  return (
    <div className="min-h-screen bg-gradient-to-r from-pink-500 to-orange-500 text-white font-sans selection:bg-white/30">
      <div className="px-4 pb-12 pt-16 text-center">
        <h1 className="mb-6 text-5xl font-extrabold tracking-tight drop-shadow-lg md:text-7xl">
          Intelligent Traffic Management System
        </h1>
        <p className="mx-auto mb-10 max-w-3xl text-xl font-medium text-white/90 md:text-2xl">
          AI-powered traffic control with dynamic signal timing and emergency vehicle prioritization.
        </p>
        <button
          onClick={onNavigateToDashboard}
          className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-lg font-bold text-orange-600 shadow-xl transition-all duration-300 hover:scale-105 hover:bg-orange-50"
        >
          Launch Live Dashboard
          <ArrowRight size={24} />
        </button>
      </div>

      <div className="mx-auto max-w-7xl space-y-24 px-4 py-12 sm:px-6 lg:px-8">
        <section>
          <h2 className="mb-12 flex items-center justify-center gap-3 text-center text-3xl font-bold drop-shadow-md md:text-4xl">
            <span>*</span> Project Features
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Timer size={40} className="text-pink-500" />}
              title="Dynamic Signal Control"
              description="Automatically adjusts green light duration based on real-time vehicle density, reducing unnecessary waiting times."
            />
            <FeatureCard
              icon={<Ambulance size={40} className="text-pink-500" />}
              title="Ambulance Priority"
              description="Detects emergency vehicles and provides an immediate green light corridor to reduce response times and save lives."
            />
            <FeatureCard
              icon={<Monitor size={40} className="text-pink-500" />}
              title="Live Dashboard"
              description="Monitor up to four lanes simultaneously with real-time video feeds, vehicle detection boxes, and traffic light status."
            />
            <FeatureCard
              icon={<BarChart3 size={40} className="text-pink-500" />}
              title="Data Analytics"
              description="View detailed graphs on vehicle flow, lane density, and system efficiency compared to traditional methods."
            />
          </div>
        </section>

        <section>
          <h2 className="mb-12 flex items-center justify-center gap-3 text-center text-3xl font-bold drop-shadow-md md:text-4xl">
            <span>+</span> Tools & Technology
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={<Terminal size={40} className="text-orange-500" />}
              title="Python Toolkit"
              description="The repository includes a practical Python workflow for frame extraction, dataset preparation, YOLO training, and inference."
            />
            <FeatureCard
              icon={<Cpu size={40} className="text-orange-500" />}
              title="YOLOv8 & OpenCV"
              description="State-of-the-art object detection using YOLOv8 and real-time video processing with OpenCV."
            />
            <FeatureCard
              icon={<Globe size={40} className="text-orange-500" />}
              title="React & Tailwind"
              description="A responsive frontend presents the dashboard, analytics, and training workflow in one place."
            />
            <FeatureCard
              icon={<LineChart size={40} className="text-orange-500" />}
              title="Recharts"
              description="The analysis dashboard uses chart components to visualize traffic flow and system performance."
            />
          </div>
        </section>

        <section className="pb-24">
          <h2 className="mb-12 flex items-center justify-center gap-3 text-center text-3xl font-bold drop-shadow-md md:text-4xl">
            <span>!</span> Project Importance
          </h2>
          <div className="mx-auto max-w-4xl space-y-8 text-lg leading-relaxed md:text-xl">
            <p>
              <strong className="text-yellow-300">Reduces Traffic Congestion:</strong> By intelligently managing signal
              times, the system minimizes bottlenecks and improves overall traffic flow, saving commuters valuable
              time.
            </p>
            <p>
              <strong className="text-yellow-300">Enhances Emergency Response:</strong> Prioritizing ambulances is
              critical. This system clears a path automatically, which can be the difference between life and death in
              critical situations.
            </p>
            <p>
              <strong className="text-yellow-300">Provides Data-Driven Insights:</strong> The analytics dashboard
              offers valuable data that city planners and traffic authorities can use to make informed decisions about
              infrastructure and traffic management strategies.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group flex flex-col items-center rounded-3xl border border-white/30 bg-white/20 p-8 text-center shadow-xl backdrop-blur-md transition-all duration-300 hover:bg-white/30">
      <div className="mb-6 rounded-2xl bg-white p-4 shadow-lg transition-transform duration-300 group-hover:scale-110">
        {icon}
      </div>
      <h3 className="mb-4 text-xl font-bold">{title}</h3>
      <p className="text-sm leading-relaxed text-white/90 md:text-base">{description}</p>
    </div>
  );
}
