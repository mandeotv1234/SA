#!/usr/bin/env python3
"""Update prompt in inference.py with enhanced data fusion logic."""

with open('app/modules/inference.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the DATA FUSION section
old_section = '''📊 DỮ LIỆU KỸ THUẬT (TECHNICAL INDICATORS):
   • RSI(14): {rsi:.2f} → Trạng thái: {tech_bias}
   • MACD: {macd:.4f} → {"Xu hướng tăng" if macd > 0 else "Xu hướng giảm"}
   • Bollinger Bands: [{bb_low:.2f} - {bb_high:.2f}]
   • Current Volatility: {dl_stats['volatility']}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 YÊU CẦU PHÂN TÍCH (3-LAYER REASONING)'''

new_section = '''📊 DỮ LIỆU KỸ THUẬT (TECHNICAL INDICATORS):
   • RSI(14): {rsi:.2f} → Trạng thái: {tech_bias}
   • MACD: {macd:.4f} → {"Xu hướng tăng" if macd > 0 else "Xu hướng giảm"}
   • Bollinger Bands: [{bb_low:.2f} - {bb_high:.2f}]
   • Current Volatility: {dl_stats['volatility']}

🔗 DATA FUSION (Kết hợp Tin tức + Kỹ thuật):
   • News Sentiment: {sentiment_score:+.2f} {"(Tích cực)" if sentiment_score > 0.3 else "(Tiêu cực)" if sentiment_score < -0.3 else "(Trung lập)"}
   • Technical Bias: {tech_bias}
   • Conflict Detection: {"⚠️ XUNG ĐỘT - Sentiment tích cực nhưng RSI quá mua" if sentiment_score > 0.3 and rsi > 70 else "⚠️ XUNG ĐỘT - Sentiment tiêu cực nhưng RSI quá bán" if sentiment_score < -0.3 and rsi < 30 else "✅ ĐỒNG THUẬN - News và Technical cùng chiều"}
   
   → QUAN TRỌNG: Nếu có xung đột, bạn PHẢI giải thích yếu tố nào chiếm ưu thế và TẠI SAO.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 YÊU CẦU PHÂN TÍCH (3-LAYER REASONING)'''

content = content.replace(old_section, new_section)

# Enhance explanation_vi requirement
old_explanation = '''"explanation_vi": "Đoạn văn phân tích 4-5 câu, SẮC SẢO, CÓ DẪN CHỨNG CỤ THỂ. Bắt đầu: 'Dự báo {direction} {dl_stats['predicted_return']:+.2f}% được thúc đẩy chủ yếu bởi...' Phải đề cập: (1) Tên sự kiện, (2) Sentiment score, (3) Tương tác với RSI/MACD, (4) Kết luận nhân quả rõ ràng."'''

new_explanation = '''"explanation_vi": "Đoạn văn 5-6 câu, CÓ DẪN CHỨNG CỤ THỂ:
    Câu 1: 'Dự báo {direction} {dl_stats['predicted_return']:+.2f}% được thúc đẩy bởi [sự kiện] (Sentiment {sentiment_score:+.2f}).'
    Câu 2-3: Giải thích cơ chế nhân quả (Tin → Tâm lý → Order flow → Giá). Có số liệu RSI, MACD.
    Câu 4: Phân tích xung đột/đồng thuận News vs Technical.
    Câu 5: Dẫn chứng lịch sử (VD: '90% lần ETF approval → tăng 15% trong 24h').
    Câu 6: Kết luận độ tin cậy và rủi ro."'''

content = content.replace(old_explanation, new_explanation)

# Enhance actionable_advice
old_advice = '''"actionable_advice": "Lời khuyên cụ thể cho trader (1-2 câu ngắn gọn, VD: 'Nên DCA trong vùng support 45K-46K. Stop-loss dưới 44.5K để phòng ngừa false breakout.')"'''

new_advice = '''"actionable_advice": "Lời khuyên CỤ THỂ (2-3 câu): Entry point, Stop-loss, Take-profit, R/R ratio. 
    VÍ DỤ: 'Entry 68.5K-69K. SL dưới 67.8K (R/R 1:3). TP T1: 71.5K, T2: 73K. Cảnh giác false breakout nếu volume giảm.'"'''

content = content.replace(old_advice, new_advice)

with open('app/modules/inference.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ Enhanced prompt with data fusion logic")
