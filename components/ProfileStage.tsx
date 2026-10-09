"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { NumberField, ProgressivePanel, SelectField, TextField } from "@/components/common";
import { RollingNumber } from "@/components/motion/RollingNumber";
import type { FitPreference, Gender, UserProfile } from "@/types/shopping";

const fitLabels: Record<FitPreference, string> = {
  slim: "슬림",
  regular: "정핏",
  relaxed: "여유",
  oversized: "오버핏",
};

const genderLabels: Record<Gender, string> = {
  female: "여성",
  male: "남성",
  non_binary: "논바이너리",
  prefer_not_to_say: "선택 안 함",
};

export function ProfileStage({ profile, onSave }: { profile: UserProfile; onSave: (profile: UserProfile) => void }) {
  const [draft, setDraft] = useState(profile);
  const [showBasics, setShowBasics] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);

  return (
    <section className="profile-stage stage-reveal">
      <div className="profile-visual">
        <p className="brand-line">Your fit</p>
        <h1>
          <RollingNumber text={`${draft.heightCm} / ${draft.weightKg}`} />
        </h1>
        <p>{fitLabels[draft.preferredFit]} 핏을 기준으로 추천합니다.</p>
        <div className="profile-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="profile-editor">
        <h2>현재 정보만으로 기본 추천이 가능합니다.</h2>
        <p>필요한 만큼만 열어 수정하세요. 상세 측정은 처음부터 요구하지 않습니다.</p>

        <ProgressivePanel title="신체 정보" open={showBasics} onToggle={() => setShowBasics((value) => !value)}>
          <div className="field-grid">
            <SelectField label="성별" value={draft.gender} options={genderLabels} onChange={(value) => setDraft({ ...draft, gender: value as Gender })} />
            <SelectField label="선호 핏" value={draft.preferredFit} options={fitLabels} onChange={(value) => setDraft({ ...draft, preferredFit: value as FitPreference })} />
            <NumberField label="키 cm" value={draft.heightCm} onChange={(heightCm) => setDraft({ ...draft, heightCm })} />
            <NumberField label="몸무게 kg" value={draft.weightKg} onChange={(weightKg) => setDraft({ ...draft, weightKg })} />
            <TextField label="평소 상의 사이즈" value={draft.topSize ?? ""} onChange={(topSize) => setDraft({ ...draft, topSize })} />
            <TextField label="평소 하의 사이즈" value={draft.bottomSize ?? ""} onChange={(bottomSize) => setDraft({ ...draft, bottomSize })} />
          </div>
        </ProgressivePanel>

        <ProgressivePanel title="추천 정확도 높이기" open={showMeasurements} onToggle={() => setShowMeasurements((value) => !value)}>
          <div className="field-grid">
            <NumberField label="가슴둘레 cm" value={draft.chestCm ?? 0} optional onChange={(chestCm) => setDraft({ ...draft, chestCm: chestCm || undefined })} />
            <NumberField label="허리둘레 cm" value={draft.waistCm ?? 0} optional onChange={(waistCm) => setDraft({ ...draft, waistCm: waistCm || undefined })} />
            <NumberField label="어깨너비 cm" value={draft.shoulderCm ?? 0} optional onChange={(shoulderCm) => setDraft({ ...draft, shoulderCm: shoulderCm || undefined })} />
          </div>
        </ProgressivePanel>

        <button onClick={() => onSave(draft)} className="primary-action">
          <span>프로필 저장</span>
          <Check size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
