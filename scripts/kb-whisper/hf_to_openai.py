#!/usr/bin/env python3
"""Konverterar en Whisper-modell i Hugging Face-format (t.ex. KBLab/kb-whisper-large)
till OpenAI:s whisper-format (.pt), som sherpa-onnx exportskript förstår.

Läser bara safetensors (inga pickle-filer från nätet), ingen fjärrkod (trust_remote_code=False).
Nyckelmappningen är inversen av transformers egna convert_openai_to_hf.py.
"""
import argparse, json, sys
from pathlib import Path
import torch
from transformers import WhisperForConditionalGeneration, WhisperConfig

# Samma tabell som i transformers convert_openai_to_hf.py (openai -> hf). Vi går åt andra hållet.
OPENAI_TO_HF = {
    "blocks": "layers", "mlp.0": "fc1", "mlp.2": "fc2", "mlp_ln": "final_layer_norm",
    ".attn.query": ".self_attn.q_proj", ".attn.key": ".self_attn.k_proj", ".attn.value": ".self_attn.v_proj",
    ".attn_ln": ".self_attn_layer_norm", ".attn.out": ".self_attn.out_proj",
    ".cross_attn.query": ".encoder_attn.q_proj", ".cross_attn.key": ".encoder_attn.k_proj",
    ".cross_attn.value": ".encoder_attn.v_proj", ".cross_attn_ln": ".encoder_attn_layer_norm",
    ".cross_attn.out": ".encoder_attn.out_proj",
    "decoder.ln.": "decoder.layer_norm.",
    # Encoderns slutnorm heter ln_post hos OpenAI men layer_norm hos HF (sista raden i tabellen).
    "encoder.ln_post.": "encoder.layer_norm.",
    "token_embedding": "embed_tokens",
    "encoder.positional_embedding": "encoder.embed_positions.weight",
    "decoder.positional_embedding": "decoder.embed_positions.weight",
}
# Längsta mönster först så att "decoder.layer_norm." inte krockar med ".self_attn_layer_norm".
HF_TO_OPENAI = sorted(((hf, oa) for oa, hf in OPENAI_TO_HF.items()), key=lambda p: -len(p[0]))


def hf_key_to_openai(key: str) -> str:
    if key.startswith("model."):
        key = key[len("model."):]
    for hf, oa in HF_TO_OPENAI:
        key = key.replace(hf, oa)
    return key


def dims_from_config(c: WhisperConfig) -> dict:
    return {
        "n_mels": c.num_mel_bins, "n_audio_ctx": c.max_source_positions, "n_audio_state": c.d_model,
        "n_audio_head": c.encoder_attention_heads, "n_audio_layer": c.encoder_layers,
        "n_vocab": c.vocab_size, "n_text_ctx": c.max_target_positions, "n_text_state": c.d_model,
        "n_text_head": c.decoder_attention_heads, "n_text_layer": c.decoder_layers,
    }


def convert(model: WhisperForConditionalGeneration, dtype=None) -> dict:
    # Minnessnålt: inga kopior, tensorerna återanvänds. dtype=float16 halverar filen (som OpenAI:s egna .pt).
    sd = {}
    for k, v in model.state_dict().items():
        if k == "proj_out.weight":  # knuten till token_embedding i OpenAI-formatet
            continue
        t = v.detach()
        sd[hf_key_to_openai(k)] = t.to(dtype) if dtype is not None else t
    return {"dims": dims_from_config(model.config), "model_state_dict": sd}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Mapp med HF-modellen (config.json + model.safetensors)")
    ap.add_argument("--out", required=True, help="Utfil .pt")
    a = ap.parse_args()
    src = Path(a.src)
    if not (src / "config.json").is_file():
        sys.exit(f"Ingen config.json i {src}")
    if not list(src.glob("*.safetensors")):
        sys.exit("Bara safetensors accepteras (säkert format utan körbar kod)")
    # Ladda i halvprecision utan att först skapa en tom fp32-modell: en tredjedel av minnet.
    model = WhisperForConditionalGeneration.from_pretrained(str(src), use_safetensors=True, trust_remote_code=False,
                                                            torch_dtype=torch.float16, low_cpu_mem_usage=True)
    ckpt = convert(model, dtype=torch.float16)
    torch.save(ckpt, a.out)
    print(json.dumps(ckpt["dims"]), "->", a.out, f"({len(ckpt['model_state_dict'])} tensorer)")


if __name__ == "__main__":
    main()
