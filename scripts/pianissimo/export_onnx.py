#!/usr/bin/env python3
"""Gör om Klang Pianissimo (NeMo, Parakeet v3-finjustering) till sherpa-onnx-format.

Bygger på sherpa-onnx:s exportskript för parakeet-tdt-0.6b-v3
(scripts/nemo/parakeet-tdt-0.6b-v3/export_onnx.py, Apache 2.0, Xiaomi Corp.).

Ut:  encoder.onnx (+ encoder.weights), decoder.onnx, joiner.onnx     full precision
     encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx         int8
     tokens.txt, bpe.vocab (för ordlista/hotwords)
"""

import argparse
import glob
import os

import nemo.collections.asr as nemo_asr
import onnx
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic

MODEL = "KlangAI/pianissimo-sv"


def add_meta_data(filename, meta_data, external=None):
    model = onnx.load(filename)
    while len(model.metadata_props):
        model.metadata_props.pop()
    for key, value in meta_data.items():
        m = model.metadata_props.add()
        m.key = key
        m.value = str(value)
    if external:
        onnx.save(model, filename, save_as_external_data=True, all_tensors_to_one_file=True, location=external)
    else:
        onnx.save(model, filename)


def write_bpe_vocab(asr_model, path):
    sp = asr_model.tokenizer.tokenizer
    with open(path, "w", encoding="utf-8") as f:
        for i in range(sp.get_piece_size()):
            f.write(f"{sp.id_to_piece(i)}\t{sp.get_score(i)}\n")


def export_all(asr_model):
    asr_model.encoder.export("encoder.onnx")
    asr_model.decoder.export("decoder.onnx")
    asr_model.joint.export("joiner.onnx")


@torch.no_grad()
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full-attention", action="store_true", help="byt till full attention innan export")
    args = ap.parse_args()

    asr_model = nemo_asr.models.ASRModel.from_pretrained(model_name=MODEL, map_location="cpu")
    asr_model.eval()
    enc = asr_model.cfg.encoder
    print("encoder:", enc.get("self_attention_model"), enc.get("att_context_size"), "subsampling", enc.get("subsampling_factor"))
    print("features:", asr_model.cfg.preprocessor.get("features"), "normalize:", asr_model.cfg.preprocessor.get("normalize"))

    if args.full_attention:
        asr_model.change_attention_model("rel_pos")
        print("bytte till full attention (rel_pos)")

    with open("tokens.txt", "w", encoding="utf-8") as f:
        for i, s in enumerate(asr_model.joint.vocabulary):
            f.write(f"{s} {i}\n")
        f.write(f"<blk> {i + 1}\n")
    write_bpe_vocab(asr_model, "bpe.vocab")

    try:
        export_all(asr_model)
    except Exception as e:  # lokal attention går inte alltid att exportera; full attention fungerar alltid
        print("export misslyckades med modellens attention:", repr(e))
        for f in glob.glob("*.onnx") + glob.glob("*.weights") + glob.glob("onnx__*"):
            os.remove(f)
        asr_model.change_attention_model("rel_pos")
        print("försöker igen med full attention (rel_pos)")
        export_all(asr_model)

    normalize_type = asr_model.cfg.preprocessor.normalize
    if normalize_type == "NA":
        normalize_type = ""
    meta_data = {
        "vocab_size": asr_model.decoder.vocab_size,
        "normalize_type": normalize_type,
        "pred_rnn_layers": asr_model.decoder.pred_rnn_layers,
        "pred_hidden": asr_model.decoder.pred_hidden,
        "subsampling_factor": int(enc.get("subsampling_factor", 8)),
        "model_type": "EncDecRNNTBPEModel",
        "version": "2",
        "model_author": "Klang (NeMo)",
        "url": f"https://huggingface.co/{MODEL}",
        "comment": "Only the transducer branch is exported",
        "feat_dim": int(asr_model.cfg.preprocessor.get("features", 128)),
    }

    for m in ["encoder", "decoder", "joiner"]:
        quantize_dynamic(
            model_input=f"./{m}.onnx",
            model_output=f"./{m}.int8.onnx",
            weight_type=QuantType.QUInt8 if m == "encoder" else QuantType.QInt8,
        )

    add_meta_data("encoder.int8.onnx", meta_data)
    add_meta_data("encoder.onnx", meta_data, external="encoder.weights")
    # Lösa viktfiler från exporten behövs inte efter att encodern sparats om med encoder.weights.
    for f in glob.glob("onnx__*") + glob.glob("*.onnx.data"):
        os.remove(f)
    print("meta_data", meta_data)
    os.system("ls -lh")


if __name__ == "__main__":
    main()
