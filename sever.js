const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

const REDDIT_BASE_URL = 'https://www.reddit.com';
const USER_AGENT = 'CompetitorAnalysis/1.0';

const SEARCH_QUERIES = {
  'Medium': ['medium.com', 'medium writing', 'medium platform', 'medium vs'],
  'Substack': ['substack', 'substack newsletter', 'substack vs'],
  'Ghost': ['ghost.org', 'ghost platform', 'ghost publishing'],
  'LinkedIn': ['linkedin articles', 'linkedin publishing'],
  'dev.to': ['dev.to', 'devto', 'dev community'],
  'Hashnode': ['hashnode', 'hashnode blog']
};

async function fetchRedditPosts(query, limit = 50) {
  try {
    const response = await axios.get(`${REDDIT_BASE_URL}/search.json`, {
      params: {
        q: query,
        limit: limit,
        sort: 'new',
        t: 'week'
      },
      headers: {
        'User-Agent': USER_AGENT
      }
    });

    return response.data.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext,
      subreddit: child.data.subreddit,
      ups: child.data.ups,
      num_comments: child.data.num_comments,
      created_utc: child.data.created_utc,
      url: child.data.url,
      author: child.data.author
    }));
  } catch (error) {
    console.error(`Error fetching Reddit data for query "${query}":`, error.message);
    return [];
  }
}

function analyzeSentiment(text) {
  const positiveWords = [
    'great', 'amazing', 'love', 'best', 'awesome', 'excellent', 'good', 
    'better', 'prefer', 'recommend', 'perfect', 'fantastic', 'outstanding'
  ];
  
  const negativeWords = [
    'terrible', 'hate', 'worst', 'bad', 'awful', 'sucks', 'problems', 
    'issues', 'disappointing', 'frustrating', 'annoying', 'broken'
  ];

  const lowerText = text.toLowerCase();
  const positiveScore = positiveWords.filter(word => lowerText.includes(word)).length;
  const negativeScore = negativeWords.filter(word => lowerText.includes(word)).length;

  const totalWords = positiveScore + negativeScore;
  if (totalWords === 0) return { sentiment: 'neutral', score: 0.5 };

  const score = positiveScore / totalWords;
  let sentiment = 'neutral';
  if (score > 0.6) sentiment = 'positive';
  else if (score < 0.4) sentiment = 'negative';

  return { sentiment, score };
}

function extractThemes(posts) {
  const themes = {};
  const keywords = [
    'monetization', 'audience', 'discovery', 'writing', 'creators', 
    'newsletter', 'paywall', 'algorithm', 'community', 'engagement',
    'seo', 'traffic', 'subscribers', 'revenue', 'analytics'
  ];

  posts.forEach(post => {
    const text = `${post.title} ${post.selftext}`.toLowerCase();
    keywords.forEach(keyword => {
      if (text.includes(keyword)) {
        themes[keyword] = (themes[keyword] || 0) + 1;
      }
    });
  });

  return Object.entries(themes)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([theme, count]) => ({ theme, count }));
}

function generateInsights(platformData) {
  const insights = [];
  
  const platformMetrics = Object.entries(platformData).map(([platform, posts]) => {
    const sentiments = posts.map(post => 
      analyzeSentiment(`${post.title} ${post.selftext}`)
    );
    
    const avgSentiment = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;
    const totalEngagement = posts.reduce((sum, post) => sum + post.ups + post.num_comments, 0);
    
    return {
      platform,
      posts: posts.length,
      sentiment: avgSentiment,
      engagement: totalEngagement,
      avgEngagement: posts.length > 0 ? totalEngagement / posts.length : 0
    };
  });

  const topByMentions = platformMetrics.sort((a, b) => b.posts - a.posts)[0];
  if (topByMentions.platform !== 'Medium' && topByMentions.posts > 10) {
    insights.push({
      type: 'threat',
      title: `${topByMentions.platform} dominating Reddit discussions`,
      confidence: Math.min(95, 70 + topByMentions.posts),
      impact: 'high',
      description: `${topByMentions.platform} has ${topByMentions.posts} Reddit mentions vs ${platformData.Medium?.length || 0} for Medium`,
      recommendation: `Investigate what's driving ${topByMentions.platform} buzz and consider counter-messaging`
    });
  }

  platformMetrics.forEach(metric => {
    if (metric.platform !== 'Medium' && metric.sentiment < 0.4 && metric.posts > 5) {
      insights.push({
        type: 'opportunity',
        title: `${metric.platform} users expressing frustration`,
        confidence: Math.floor(60 + (0.5 - metric.sentiment) * 80),
        impact: 'medium',
        description: `Low sentiment (${(metric.sentiment * 100).toFixed(1)}%) in ${metric.posts} Reddit discussions about ${metric.platform}`,
        recommendation: `Target dissatisfied ${metric.platform} users with Medium's advantages`
      });
    }
  });

  const highEngagement = platformMetrics.filter(m => m.avgEngagement > 50 && m.platform !== 'Medium');
  if (highEngagement.length > 0) {
    const platform = highEngagement[0];
    insights.push({
      type: 'trend',
      title: `${platform.platform} generating high engagement`,
      confidence: 75,
      impact: 'medium',
      description: `${platform.platform} posts averaging ${platform.avgEngagement.toFixed(1)} upvotes/comments`,
      recommendation: `Study ${platform.platform}'s content strategy and community engagement tactics`
    });
  }

  return insights;
}

app.get('/api/analyze', async (req, res) => {
  try {
    console.log('Starting Reddit competitive analysis...');
    const platformData = {};
    
    for (const [platform, queries] of Object.entries(SEARCH_QUERIES)) {
      console.log(`Fetching data for ${platform}...`);
      const allPosts = [];
      
      for (const query of queries) {
        const posts = await fetchRedditPosts(query, 25);
        allPosts.push(...posts);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const uniquePosts = allPosts.filter((post, index, self) => 
        index === self.findIndex(p => p.id === post.id)
      );
      
      platformData[platform] = uniquePosts.slice(0, 30);
    }

    const insights = generateInsights(platformData);
    const allPosts = Object.values(platformData).flat();
    const themes = extractThemes(allPosts);
    
    const competitors = Object.entries(platformData).map(([platform, posts]) => {
      const sentimentData = posts.map(post => 
        analyzeSentiment(`${post.title} ${post.selftext}`)
      );
      
      const avgSentiment = sentimentData.reduce((sum, s) => sum + s.score, 0) / sentimentData.length || 0;
      const totalUpvotes = posts.reduce((sum, post) => sum + post.ups, 0);
      
      return {
        platform,
        mentions: posts.length,
        sentiment: avgSentiment,
        engagement: totalUpvotes,
        recentPosts: posts.slice(0, 3).map(post => ({
          title: post.title,
          subreddit: post.subreddit,
          ups: post.ups,
          comments: post.num_comments
        }))
      };
    });

    res.json({
      success: true,
      data: {
        insights,
        themes,
        competitors,
        totalPosts: allPosts.length,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze Reddit data'
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Reddit Competitive Intelligence API running on port ${PORT}`);
});

module.exports = app;
